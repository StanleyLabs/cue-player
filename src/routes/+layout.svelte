<script lang="ts">
	import { onMount } from 'svelte';
	import { requestPersistentStorage } from '$lib/storage/library';
	import LoadingWaveform from '$lib/components/LoadingWaveform.svelte';
	import { loading } from '$lib/stores/loading';
	import '../app.css';

	let { children } = $props();

	onMount(async () => {
		try {
			await requestPersistentStorage();
		} catch (error) {
			console.error('Error during app initialization:', error);
		}
	});
</script>

<!-- Global loading indicator - only show for actual loading operations -->
<LoadingWaveform 
	message={$loading.message} 
	show={$loading.isLoading}
	allowDismiss={false}
/>

{@render children()}
