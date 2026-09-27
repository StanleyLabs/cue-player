<script lang="ts">
	import { onMount } from 'svelte';
	import { requestPersistentStorage } from '$lib/storage/library';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		void requestPersistentStorage();
	});
</script>

{@render children()}
