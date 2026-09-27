/**
 * Pulls the AAC audio track out of an ISO base media file (MP4, M4V, MOV,
 * 3GP) without touching the video. The `moov` index lists the byte range of
 * every audio sample, so we read only those ranges and re-wrap the frames as
 * an ADTS stream, which decodeAudioData understands. A 10 minute phone video
 * is typically hundreds of megabytes; its AAC track is about 10.
 *
 * Returns null for anything it does not handle (fragmented files, non-AAC
 * audio, other containers) so the caller can fall back to a whole-file decode.
 */

const BOX_HEADER = 8;
const ADTS_HEADER = 7;
const MAX_ADTS_FRAME = 0x1fff - ADTS_HEADER; // frame_length is a 13-bit field
const MOOV_SANITY_LIMIT = 64 * 1024 * 1024;
const COALESCE_GAP = 16 * 1024; // merge reads separated by less than this
const MAX_RANGE_BYTES = 4 * 1024 * 1024; // bound on a single merged read (bounds transient memory)
const READ_CONCURRENCY = 8;

export type ContainerKind = 'iso' | 'matroska' | 'other';

/** Cheap content sniff from the first bytes; independent of file name or MIME type. */
export async function sniffContainer(file: Blob): Promise<ContainerKind> {
	if (file.size < 12) return 'other';
	const head = new DataView(await file.slice(0, 12).arrayBuffer());
	if (head.getUint32(0) === 0x1a45dfa3) return 'matroska'; // EBML header (WebM / MKV)
	const type = fourcc(head, 4);
	if (['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot'].includes(type)) return 'iso';
	return 'other';
}

type Box = { type: string; start: number; end: number };

type AudioSpecificConfig = { profile: number; freqIndex: number; channels: number };

type Chunk = { offset: number; byteLength: number; firstSample: number; sampleCount: number; outOffset: number };

type AudioTrack = { asc: AudioSpecificConfig; sampleSizes: Uint32Array; chunks: Chunk[] };

export async function extractAacTrack(file: Blob): Promise<ArrayBuffer | null> {
	const moov = await findMoov(file);
	if (!moov) return null;
	const track = parseMoov(moov);
	if (!track) return null;
	return readAsAdts(file, track);
}

// ---------------------------------------------------------------------------
// Reading helpers

function fourcc(view: DataView, offset: number): string {
	return String.fromCharCode(
		view.getUint8(offset),
		view.getUint8(offset + 1),
		view.getUint8(offset + 2),
		view.getUint8(offset + 3)
	);
}

async function readBytes(file: Blob, start: number, length: number): Promise<DataView> {
	const end = Math.min(file.size, start + length);
	return new DataView(await file.slice(start, end).arrayBuffer());
}

/** Iterate the boxes laid out between `start` and `end` of an in-memory view. */
function* boxes(view: DataView, start: number, end: number): Generator<Box> {
	let pos = start;
	while (pos + BOX_HEADER <= end) {
		let size = view.getUint32(pos);
		const type = fourcc(view, pos + 4);
		let header = BOX_HEADER;
		if (size === 1) {
			if (pos + 16 > end) return;
			size = Number(view.getBigUint64(pos + 8));
			header = 16;
		} else if (size === 0) {
			size = end - pos;
		}
		if (size < header || pos + size > end) return;
		yield { type, start: pos + header, end: pos + size };
		pos += size;
	}
}

function findBox(view: DataView, start: number, end: number, type: string): Box | null {
	for (const box of boxes(view, start, end)) if (box.type === type) return box;
	return null;
}

/** Walk the top-level boxes of the file, skipping over `mdat` by size, and return the moov body. */
async function findMoov(file: Blob): Promise<DataView | null> {
	let pos = 0;
	while (pos + BOX_HEADER <= file.size) {
		const head = await readBytes(file, pos, 16);
		if (head.byteLength < BOX_HEADER) return null;
		let size = head.getUint32(0);
		const type = fourcc(head, 4);
		let header = BOX_HEADER;
		if (size === 1) {
			if (head.byteLength < 16) return null;
			size = Number(head.getBigUint64(8));
			header = 16;
		} else if (size === 0) {
			size = file.size - pos;
		}
		if (size < header) return null;
		if (type === 'moov') {
			if (size > MOOV_SANITY_LIMIT) return null;
			return readBytes(file, pos + header, size - header);
		}
		pos += size;
	}
	return null;
}

// ---------------------------------------------------------------------------
// moov parsing

function parseMoov(view: DataView): AudioTrack | null {
	const end = view.byteLength;
	// Fragmented files keep their samples in moof boxes we do not index.
	if (findBox(view, 0, end, 'mvex')) return null;

	for (const trak of boxes(view, 0, end)) {
		if (trak.type !== 'trak') continue;
		const mdia = findBox(view, trak.start, trak.end, 'mdia');
		if (!mdia) continue;
		const hdlr = findBox(view, mdia.start, mdia.end, 'hdlr');
		// hdlr: version/flags (4), pre_defined (4), handler_type (4)
		if (!hdlr || hdlr.end - hdlr.start < 12 || fourcc(view, hdlr.start + 8) !== 'soun') continue;
		const minf = findBox(view, mdia.start, mdia.end, 'minf');
		const stbl = minf && findBox(view, minf.start, minf.end, 'stbl');
		if (!stbl) continue;
		const track = parseSampleTable(view, stbl);
		if (track) return track;
	}
	return null;
}

function parseSampleTable(view: DataView, stbl: Box): AudioTrack | null {
	const stsd = findBox(view, stbl.start, stbl.end, 'stsd');
	const stsc = findBox(view, stbl.start, stbl.end, 'stsc');
	const stsz = findBox(view, stbl.start, stbl.end, 'stsz');
	const stz2 = stsz ? null : findBox(view, stbl.start, stbl.end, 'stz2');
	const stco = findBox(view, stbl.start, stbl.end, 'stco');
	const co64 = stco ? null : findBox(view, stbl.start, stbl.end, 'co64');
	if (!stsd || !stsc || !(stsz || stz2) || !(stco || co64)) return null;

	const asc = parseStsd(view, stsd);
	if (!asc) return null;
	const sampleSizes = stsz ? parseStsz(view, stsz) : parseStz2(view, stz2!);
	if (!sampleSizes) return null;
	const offsets = stco ? parseOffsets(view, stco, false) : parseOffsets(view, co64!, true);
	const stscEntries = parseStsc(view, stsc);
	if (!offsets || !stscEntries) return null;

	const chunks: Chunk[] = [];
	let sample = 0;
	let outOffset = 0;
	let entry = 0;
	for (let c = 0; c < offsets.length && sample < sampleSizes.length; c += 1) {
		while (entry + 1 < stscEntries.length && stscEntries[entry + 1].firstChunk <= c + 1) entry += 1;
		const count = Math.min(stscEntries[entry].samplesPerChunk, sampleSizes.length - sample);
		let byteLength = 0;
		for (let s = sample; s < sample + count; s += 1) byteLength += sampleSizes[s];
		chunks.push({ offset: offsets[c], byteLength, firstSample: sample, sampleCount: count, outOffset });
		outOffset += byteLength + count * ADTS_HEADER;
		sample += count;
	}
	if (chunks.length === 0) return null;
	return { asc, sampleSizes, chunks };
}

function parseStsd(view: DataView, stsd: Box): AudioSpecificConfig | null {
	const count = view.getUint32(stsd.start + 4);
	let pos = stsd.start + 8;
	for (let i = 0; i < count && pos + 16 <= stsd.end; i += 1) {
		const size = view.getUint32(pos);
		const format = fourcc(view, pos + 4);
		if (size < 16 || pos + size > stsd.end) return null;
		if (format === 'mp4a') {
			// header (8) + reserved (6) + data_reference_index (2), then the
			// QuickTime sound description whose length depends on its version.
			const version = view.getUint16(pos + 16);
			const childrenStart = pos + (version === 1 ? 52 : version === 2 ? 72 : 36);
			const asc = findEsds(view, childrenStart, pos + size);
			if (asc) return asc;
		}
		pos += size;
	}
	return null;
}

function findEsds(view: DataView, start: number, end: number): AudioSpecificConfig | null {
	for (const box of boxes(view, start, end)) {
		if (box.type === 'esds') return parseEsds(view, box);
		if (box.type === 'wave') {
			// QuickTime wraps the esds in a 'wave' atom.
			const nested = findEsds(view, box.start, box.end);
			if (nested) return nested;
		}
	}
	return null;
}

function readDescriptor(view: DataView, pos: number, end: number) {
	if (pos >= end) return null;
	const tag = view.getUint8(pos);
	pos += 1;
	let size = 0;
	for (let i = 0; i < 4 && pos < end; i += 1) {
		const byte = view.getUint8(pos);
		pos += 1;
		size = (size << 7) | (byte & 0x7f);
		if (!(byte & 0x80)) break;
	}
	return { tag, bodyStart: pos, end: Math.min(end, pos + size) };
}

function parseEsds(view: DataView, esds: Box): AudioSpecificConfig | null {
	let pos = esds.start + 4; // version/flags
	const end = esds.end;
	while (pos < end) {
		const descriptor = readDescriptor(view, pos, end);
		if (!descriptor) return null;
		if (descriptor.tag === 0x03) {
			// ES_Descriptor: ES_ID (2), flags (1), then optional fields, then children.
			let inner = descriptor.bodyStart + 2;
			if (inner >= end) return null;
			const flags = view.getUint8(inner);
			inner += 1;
			if (flags & 0x80) inner += 2;
			if (flags & 0x40) inner += 1 + view.getUint8(inner);
			if (flags & 0x20) inner += 2;
			pos = inner;
			continue;
		}
		if (descriptor.tag === 0x04) {
			// DecoderConfigDescriptor: 13 fixed bytes, then DecoderSpecificInfo.
			pos = descriptor.bodyStart + 13;
			continue;
		}
		if (descriptor.tag === 0x05) {
			return parseAudioSpecificConfig(view, descriptor.bodyStart, descriptor.end);
		}
		pos = descriptor.end;
	}
	return null;
}

function parseAudioSpecificConfig(view: DataView, start: number, end: number): AudioSpecificConfig | null {
	let bitPos = 0;
	const bits = (n: number): number => {
		let value = 0;
		for (let i = 0; i < n; i += 1) {
			const byteIndex = start + (bitPos >> 3);
			if (byteIndex >= end) throw new Error('short AudioSpecificConfig');
			const bit = (view.getUint8(byteIndex) >> (7 - (bitPos & 7))) & 1;
			value = (value << 1) | bit;
			bitPos += 1;
		}
		return value;
	};
	try {
		let aot = bits(5);
		if (aot === 31) aot = 32 + bits(6);
		const freqIndex = bits(4);
		if (freqIndex === 15) return null; // explicit rate; ADTS cannot express it
		const channels = bits(4);
		if (aot === 5 || aot === 29) {
			// HE-AAC: the core AAC object type follows the SBR extension rate.
			if (bits(4) === 15) bits(24);
			aot = bits(5);
			if (aot === 31) aot = 32 + bits(6);
		}
		if (aot < 1 || aot > 4) return null; // ADTS profile covers Main, LC, SSR, LTP only
		return { profile: aot - 1, freqIndex, channels };
	} catch {
		return null;
	}
}

function parseStsz(view: DataView, stsz: Box): Uint32Array | null {
	const fixedSize = view.getUint32(stsz.start + 4);
	const count = view.getUint32(stsz.start + 8);
	const sizes = new Uint32Array(count);
	if (fixedSize !== 0) {
		sizes.fill(fixedSize);
		return sizes;
	}
	if (stsz.start + 12 + count * 4 > stsz.end) return null;
	for (let i = 0; i < count; i += 1) sizes[i] = view.getUint32(stsz.start + 12 + i * 4);
	return sizes;
}

function parseStz2(view: DataView, stz2: Box): Uint32Array | null {
	const fieldSize = view.getUint8(stz2.start + 7);
	const count = view.getUint32(stz2.start + 8);
	const sizes = new Uint32Array(count);
	const base = stz2.start + 12;
	if (fieldSize === 8) {
		if (base + count > stz2.end) return null;
		for (let i = 0; i < count; i += 1) sizes[i] = view.getUint8(base + i);
	} else if (fieldSize === 16) {
		if (base + count * 2 > stz2.end) return null;
		for (let i = 0; i < count; i += 1) sizes[i] = view.getUint16(base + i * 2);
	} else {
		return null;
	}
	return sizes;
}

function parseOffsets(view: DataView, box: Box, wide: boolean): number[] | null {
	const count = view.getUint32(box.start + 4);
	const width = wide ? 8 : 4;
	if (box.start + 8 + count * width > box.end) return null;
	const offsets = new Array<number>(count);
	for (let i = 0; i < count; i += 1) {
		const at = box.start + 8 + i * width;
		offsets[i] = wide ? Number(view.getBigUint64(at)) : view.getUint32(at);
	}
	return offsets;
}

function parseStsc(view: DataView, stsc: Box): { firstChunk: number; samplesPerChunk: number }[] | null {
	const count = view.getUint32(stsc.start + 4);
	if (count === 0 || stsc.start + 8 + count * 12 > stsc.end) return null;
	const entries = new Array(count);
	for (let i = 0; i < count; i += 1) {
		const at = stsc.start + 8 + i * 12;
		entries[i] = { firstChunk: view.getUint32(at), samplesPerChunk: view.getUint32(at + 4) };
	}
	return entries;
}

// ---------------------------------------------------------------------------
// Sample extraction

function writeAdtsHeader(out: Uint8Array, pos: number, payloadLength: number, asc: AudioSpecificConfig): void {
	const frameLength = payloadLength + ADTS_HEADER;
	out[pos] = 0xff;
	out[pos + 1] = 0xf1; // sync, MPEG-4, layer 0, no CRC
	out[pos + 2] = ((asc.profile & 3) << 6) | ((asc.freqIndex & 0xf) << 2) | ((asc.channels >> 2) & 1);
	out[pos + 3] = ((asc.channels & 3) << 6) | ((frameLength >> 11) & 3);
	out[pos + 4] = (frameLength >> 3) & 0xff;
	out[pos + 5] = ((frameLength & 7) << 5) | 0x1f;
	out[pos + 6] = 0xfc;
}

async function readAsAdts(file: Blob, track: AudioTrack): Promise<ArrayBuffer | null> {
	const { asc, sampleSizes, chunks } = track;
	for (let i = 0; i < sampleSizes.length; i += 1) {
		if (sampleSizes[i] > MAX_ADTS_FRAME) return null;
	}
	const last = chunks[chunks.length - 1];
	const total = last.outOffset + last.byteLength + last.sampleCount * ADTS_HEADER;
	const out = new Uint8Array(total);

	// Audio chunks are interleaved with video; coalesce neighbours into as few reads as possible.
	type Range = { start: number; end: number; chunks: Chunk[] };
	const ranges: Range[] = [];
	for (const chunk of chunks) {
		const start = chunk.offset;
		const end = start + chunk.byteLength;
		if (end > file.size) return null; // index points outside the file
		const tail = ranges[ranges.length - 1];
		if (tail && start >= tail.end && start - tail.end <= COALESCE_GAP && end - tail.start <= MAX_RANGE_BYTES) {
			tail.end = end;
			tail.chunks.push(chunk);
		} else {
			ranges.push({ start, end, chunks: [chunk] });
		}
	}

	const copyRange = async (range: Range) => {
		const bytes = new Uint8Array(await file.slice(range.start, range.end).arrayBuffer());
		for (const chunk of range.chunks) {
			let src = chunk.offset - range.start;
			let dst = chunk.outOffset;
			for (let s = chunk.firstSample; s < chunk.firstSample + chunk.sampleCount; s += 1) {
				const size = sampleSizes[s];
				writeAdtsHeader(out, dst, size, asc);
				out.set(bytes.subarray(src, src + size), dst + ADTS_HEADER);
				src += size;
				dst += size + ADTS_HEADER;
			}
		}
	};

	for (let i = 0; i < ranges.length; i += READ_CONCURRENCY) {
		await Promise.all(ranges.slice(i, i + READ_CONCURRENCY).map(copyRange));
	}
	return out.buffer;
}
