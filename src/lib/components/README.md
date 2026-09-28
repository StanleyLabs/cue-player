# Cue Player Loading Animation System

## Overview

The Cue Player includes a beautiful waveform loading animation that appears during slow operations like audio processing, network requests, or heavy computations. The animation features animated waveform bars that match the app's visual design.

## Components

### LoadingWaveform.svelte

The main loading animation component featuring:
- **Animated waveform bars**: 32 bars with randomized heights and animation timings
- **Glassmorphic design**: Matches the app's design language with gradients and transparency
- **Responsive**: Adapts to different screen sizes
- **Accessible**: Includes proper ARIA labels and reduced motion support
- **Customizable messages**: Can display different loading messages

**Props:**
- `message?: string` - The loading message to display (default: "Loading...")
- `show?: boolean` - Whether to show the loading animation (default: true)

### Loading Store (`/lib/stores/loading.ts`)

A Svelte store that manages global loading state:

```typescript
import { loading } from '$lib/stores/loading';

// Show loading with custom message
loading.show('Processing audio...', 1000); // minimum 1 second

// Hide loading
loading.hide();

// Wrap async operations
const result = await loading.withLoading(
  async () => {
    return await someAsyncOperation();
  },
  'Custom loading message...',
  500 // minimum duration
);

// Simulate slow network (development only)
const result = await loading.withSlowNetwork(
  async () => {
    return await networkOperation();
  },
  'Connecting...',
  2000 // artificial delay in dev mode
);
```

**Helper Functions:**
- `showAppLoading()` - Shows "Initializing Cue Player..."
- `showAudioLoading()` - Shows "Processing audio file..."
- `showNetworkLoading()` - Shows "Connecting..."
- `hideLoading()` - Hides any loading state

## Usage Examples

### Basic Loading
```svelte
<script>
  import { loading } from '$lib/stores/loading';
  
  async function processFile() {
    loading.show('Processing file...', 800);
    try {
      await heavyOperation();
    } finally {
      loading.hide();
    }
  }
</script>
```

### Automatic Loading Management
```svelte
<script>
  import { loading } from '$lib/stores/loading';
  
  async function uploadFile() {
    const result = await loading.withLoading(
      () => uploadToServer(),
      'Uploading file...',
      1000
    );
    return result;
  }
</script>
```

### Conditional Button State
```svelte
<script>
  import { loading } from '$lib/stores/loading';
</script>

<button 
  disabled={$loading.isLoading}
  onclick={processFile}
>
  {$loading.isLoading ? 'Processing...' : 'Process File'}
</button>
```

## Implementation Details

### Animation Features
- **Staggered timing**: Each waveform bar has randomized animation delays and durations
- **Smooth transitions**: CSS transitions for fade-in/fade-out effects
- **Performance optimized**: Uses CSS transforms and GPU acceleration
- **Accessibility**: Respects `prefers-reduced-motion` settings

### Design Integration
- Uses CSS custom properties from the app's design system
- Matches existing color scheme with accent colors
- Consistent with the app's glassmorphic design language
- Responsive breakpoints match the main app layout

### Development Tools
In development mode, the main page includes test buttons to preview different loading scenarios:
- Audio processing simulation
- Network slow connection simulation  
- Custom task simulation

## Best Practices

1. **Minimum Duration**: Always set a minimum duration (500-1000ms) to prevent flickering for quick operations
2. **Descriptive Messages**: Use specific messages like "Processing audio..." instead of generic "Loading..."
3. **Button States**: Disable interactive elements while loading and update button text
4. **Error Handling**: Always hide loading state in error cases
5. **Network Simulation**: Use `withSlowNetwork()` in development to test slow connection scenarios

## Styling

The loading animation automatically inherits the app's CSS custom properties:
- `--accent` and `--accent-light` for waveform colors
- `--bg`, `--bg-elev`, `--bg-elev-2` for backgrounds
- `--text` and `--muted` for typography
- All spacing and sizing uses the app's design tokens

## Performance

- Uses `transform` and `opacity` for animations (GPU accelerated)
- Minimal DOM elements (32 waveform bars)
- CSS animations run independently of JavaScript
- Automatic cleanup of timeouts and event listeners