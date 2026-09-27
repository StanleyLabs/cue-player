/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `cue-player-${version}`;
const ASSETS = [...build, ...files];

// In development, `build` is empty. Claiming fetches there stalls Vite module
// workers, so the waveform never finishes drawing.
if (build.length === 0) {
	sw.addEventListener('install', () => {
		sw.skipWaiting();
	});
	sw.addEventListener('activate', (event) => {
		event.waitUntil(sw.clients.claim());
	});
} else {
	sw.addEventListener('install', (event) => {
		event.waitUntil(
			caches
				.open(CACHE)
				.then((cache) => cache.addAll(ASSETS))
				.then(() => sw.skipWaiting())
		);
	});

	sw.addEventListener('activate', (event) => {
		event.waitUntil(
			caches
				.keys()
				.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
				.then(() => sw.clients.claim())
		);
	});

	sw.addEventListener('fetch', (event) => {
		const request = event.request;
		if (request.method !== 'GET') return;

		const url = new URL(request.url);
		if (url.origin !== sw.location.origin) return;

		event.respondWith(respond(request, url));
	});
}

async function respond(request: Request, url: URL): Promise<Response> {
	const cache = await caches.open(CACHE);

	if (ASSETS.includes(url.pathname)) {
		const cached = await cache.match(url.pathname);
		if (cached) return cached;
	}

	try {
		const response = await fetch(request);
		if (!(response instanceof Response)) {
			throw new Error('invalid response from fetch');
		}
		return response;
	} catch (error) {
		if (request.mode === 'navigate') {
			const shell = (await cache.match('/index.html')) ?? (await cache.match('/'));
			if (shell) return shell;
		}
		const cached = await cache.match(request);
		if (cached) return cached;
		throw error;
	}
}
