// Initialize Audio Context
let audioContext;
let masterGainNode;
let analyser;
let activeOscillators = {};
let delayNode;
let reverbNode;
let distortionNode;

// Store current settings
let currentSettings = {
    osc1: {
        waveform: 'sine',
        detune: 0,
        gain: 0.5
    },
    osc2: {
        waveform: 'square',
        detune: 0,
        gain: 0.5
    },
    envelope: {
        attack: 0.01,
        decay: 0.1,
        sustain: 0.7,
        release: 0.1
    },
    volume: 0.5,
    reverb: 0,
    delay: 0,
    distortion: 0
};

// Sequencer variables
let sequenceData = {};
let sequencerInterval = null;
let currentStep = 0;
let isPlaying = false;
let tempo = 120; // BPM

// Presets
const presets = {
    default: {
        waveform: 'sine',
        volume: 0.5,
        reverb: 0,
        delay: 0,
        distortion: 0
    },
    bass: {
        waveform: 'sawtooth',
        volume: 0.7,
        reverb: 0.1,
        delay: 0,
        distortion: 0.3
    },
    lead: {
        waveform: 'square',
        volume: 0.4,
        reverb: 0.2,
        delay: 0.3,
        distortion: 0.1
    },
    pad: {
        waveform: 'sine',
        volume: 0.3,
        reverb: 0.8,
        delay: 0.4,
        distortion: 0
    }
};

// Note frequencies (for one octave)
const noteFrequencies = {
    'C4': 261.63,
    'C#4': 277.18,
    'D4': 293.66,
    'D#4': 311.13,
    'E4': 329.63,
    'F4': 349.23,
    'F#4': 369.99,
    'G4': 392.00,
    'G#4': 415.30,
    'A4': 440.00,
    'A#4': 466.16,
    'B4': 493.88,
    'C5': 523.25,
    'C#5': 554.37,
    'D5': 587.33,
    'D#5': 622.25,
    'E5': 659.25
};

// Keyboard mapping
const keyboardMap = {
    'a': 'C4',
    'w': 'C#4',
    's': 'D4',
    'e': 'D#4',
    'd': 'E4',
    'f': 'F4',
    't': 'F#4',
    'g': 'G4',
    'y': 'G#4',
    'h': 'A4',
    'u': 'A#4',
    'j': 'B4',
    'k': 'C5',
    'o': 'C#5',
    'l': 'D5',
    'p': 'D#5',
    ';': 'E5'
};

// DOM Elements
let waveform1Select;
let waveform2Select;
let detune1Slider;
let detune1Value;
let detune2Slider;
let detune2Value;
let osc1GainSlider;
let osc1GainValue;
let osc2GainSlider;
let osc2GainValue;
let volumeSlider;
let volumeValue;
let attackSlider;
let attackValue;
let decaySlider;
let decayValue;
let sustainSlider;
let sustainValue;
let releaseSlider;
let releaseValue;
let reverbSlider;
let reverbValue;
let delaySlider;
let delayValue;
let distortionSlider;
let distortionValue;
let presetSelect;
let loadPresetButton;
let savePresetButton;
let keys;
let visualizer;
let visualizerContext;
let oscTabs;
let oscPanels;
let playSequenceButton;
let stopSequenceButton;
let tempoSlider;
let tempoValue;
let sequenceSteps;

// Initialize the application when the window loads
window.addEventListener('load', init);

function init() {
    try {
        // Setup audio context
        initAudio();
        
        // Get DOM elements
        setupDOMElements();
        
        // Setup event listeners
        setupEventListeners();
        
        // Setup visualizer
        setupVisualizer();
        
        // Initial render of visualizer
        requestAnimationFrame(drawVisualizer);
    } catch (e) {
        console.error('Error initializing synthesizer:', e);
        alert('Error initializing synthesizer. Please check console for details.');
    }
}

function initAudio() {
    // Create audio context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create master gain node
    masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = currentSettings.volume;
    
    // Create analyser node for visualization
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    
    // Create effects nodes
    setupEffectsNodes();
    
    // Connect nodes: masterGain -> effects -> analyser -> destination
    masterGainNode.connect(distortionNode);
    distortionNode.connect(delayNode);
    delayNode.connect(reverbNode);
    reverbNode.connect(analyser);
    analyser.connect(audioContext.destination);
}

function setupEffectsNodes() {
    // Create delay node
    delayNode = audioContext.createDelay();
    delayNode.delayTime.value = 0.3;
    
    const delayFeedback = audioContext.createGain();
    delayFeedback.gain.value = currentSettings.delay;
    
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    
    // Create simple reverb (convolver would be better for real reverb)
    reverbNode = audioContext.createGain();
    reverbNode.gain.value = 1;
    
    // Create distortion node
    distortionNode = audioContext.createWaveShaper();
    distortionNode.curve = makeDistortionCurve(currentSettings.distortion * 400);
    distortionNode.oversample = '4x';
}

function setupDOMElements() {
    // Oscillator controls
    waveform1Select = document.getElementById('waveform1');
    waveform2Select = document.getElementById('waveform2');
    detune1Slider = document.getElementById('detune1');
    detune1Value = document.getElementById('detune1-value');
    detune2Slider = document.getElementById('detune2');
    detune2Value = document.getElementById('detune2-value');
    osc1GainSlider = document.getElementById('osc1-gain');
    osc1GainValue = document.getElementById('osc1-gain-value');
    osc2GainSlider = document.getElementById('osc2-gain');
    osc2GainValue = document.getElementById('osc2-gain-value');
    
    // Envelope controls
    attackSlider = document.getElementById('attack');
    attackValue = document.getElementById('attack-value');
    decaySlider = document.getElementById('decay');
    decayValue = document.getElementById('decay-value');
    sustainSlider = document.getElementById('sustain');
    sustainValue = document.getElementById('sustain-value');
    releaseSlider = document.getElementById('release');
    releaseValue = document.getElementById('release-value');
    
    // Effects controls
    volumeSlider = document.getElementById('volume');
    volumeValue = document.getElementById('volume-value');
    reverbSlider = document.getElementById('reverb');
    reverbValue = document.getElementById('reverb-value');
    delaySlider = document.getElementById('delay');
    delayValue = document.getElementById('delay-value');
    distortionSlider = document.getElementById('distortion');
    distortionValue = document.getElementById('distortion-value');
    
    // Preset controls
    presetSelect = document.getElementById('preset-select');
    loadPresetButton = document.getElementById('load-preset');
    savePresetButton = document.getElementById('save-preset');
    
    // Keyboard
    keys = document.querySelectorAll('.key');
    
    // Visualizer
    visualizer = document.getElementById('visualizer');
    visualizerContext = visualizer.getContext('2d');
    
    // Oscillator tabs
    oscTabs = document.querySelectorAll('.osc-tab');
    oscPanels = document.querySelectorAll('.oscillator-panel');
    
    // Sequencer controls
    playSequenceButton = document.getElementById('play-sequence');
    stopSequenceButton = document.getElementById('stop-sequence');
    tempoSlider = document.getElementById('tempo');
    tempoValue = document.getElementById('tempo-value');
    sequenceSteps = document.querySelectorAll('.step');
    
    // Initialize sequencer data
    document.querySelectorAll('.sequence-row').forEach(row => {
        const note = row.dataset.note;
        sequenceData[note] = Array(8).fill(false);
    });
}

function setupEventListeners() {
    // Oscillator controls listeners
    waveform1Select.addEventListener('change', updateOscillator1);
    waveform2Select.addEventListener('change', updateOscillator2);
    detune1Slider.addEventListener('input', updateOscillator1);
    detune2Slider.addEventListener('input', updateOscillator2);
    osc1GainSlider.addEventListener('input', updateOscillator1);
    osc2GainSlider.addEventListener('input', updateOscillator2);
    
    // Envelope controls listeners
    attackSlider.addEventListener('input', updateEnvelope);
    decaySlider.addEventListener('input', updateEnvelope);
    sustainSlider.addEventListener('input', updateEnvelope);
    releaseSlider.addEventListener('input', updateEnvelope);
    
    // Effect controls listeners
    volumeSlider.addEventListener('input', updateVolume);
    reverbSlider.addEventListener('input', updateReverb);
    delaySlider.addEventListener('input', updateDelay);
    distortionSlider.addEventListener('input', updateDistortion);
    
    // Preset listeners
    loadPresetButton.addEventListener('click', loadPreset);
    savePresetButton.addEventListener('click', savePreset);
    
    // Oscillator tabs listeners
    oscTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            oscTabs.forEach(t => t.classList.remove('active'));
            oscPanels.forEach(p => p.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(`${tab.dataset.osc}-panel`).classList.add('active');
        });
    });
    
    // Keyboard listeners
    keys.forEach(key => {
        key.addEventListener('mousedown', () => playNote(key.dataset.note));
        key.addEventListener('mouseup', () => stopNote(key.dataset.note));
        key.addEventListener('mouseleave', () => stopNote(key.dataset.note));
    });
    
    // Computer keyboard controls
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // Sequencer controls
    playSequenceButton.addEventListener('click', startSequencer);
    stopSequenceButton.addEventListener('click', stopSequencer);
    tempoSlider.addEventListener('input', updateTempo);
    
    // Sequencer steps listeners
    sequenceSteps.forEach(step => {
        step.addEventListener('click', () => {
            const row = step.closest('.sequence-row');
            const note = row.dataset.note;
            const stepIndex = parseInt(step.dataset.step);
            
            // Toggle step
            sequenceData[note][stepIndex] = !sequenceData[note][stepIndex];
            step.classList.toggle('active', sequenceData[note][stepIndex]);
        });
    });
    
    // Window resize for visualizer
    window.addEventListener('resize', resizeVisualizer);
}

function setupVisualizer() {
    // Set canvas to full size of container
    resizeVisualizer();
}

function resizeVisualizer() {
    const container = document.querySelector('.visualizer-container');
    visualizer.width = container.clientWidth;
    visualizer.height = container.clientHeight;
}

// Audio control functions
function updateWaveform() {
    currentSettings.waveform = waveformSelect.value;
    
    // Update any active oscillators
    Object.keys(activeOscillators).forEach(note => {
        const oscillator = activeOscillators[note].oscillator;
        oscillator.type = currentSettings.waveform;
    });
}

function updateVolume() {
    const value = parseFloat(volumeSlider.value);
    volumeValue.textContent = value.toFixed(2);
    currentSettings.volume = value;
    masterGainNode.gain.value = value;
}

function updateReverb() {
    const value = parseFloat(reverbSlider.value);
    reverbValue.textContent = value.toFixed(2);
    currentSettings.reverb = value;
    // In a real reverb, we'd update the convolver node
    // For our simple demo, adjust gain to simulate reverb level
    reverbNode.gain.value = 1 + value * 2;
}

function updateDelay() {
    const value = parseFloat(delaySlider.value);
    delayValue.textContent = value.toFixed(2);
    currentSettings.delay = value;
    // Get the delay feedback gain node and update it
    const delayFeedback = delayNode._feedbackGain || 
        (delayNode._feedbackGain = audioContext.createGain());
    delayFeedback.gain.value = value * 0.8; // Scale to prevent feedback explosion
}

function updateDistortion() {
    const value = parseFloat(distortionSlider.value);
    distortionValue.textContent = value.toFixed(2);
    currentSettings.distortion = value;
    distortionNode.curve = makeDistortionCurve(value * 400);
}

function loadPreset() {
    const presetName = presetSelect.value;
    const preset = presets[presetName];
    
    if (preset) {
        // Apply preset values to controls and audio nodes
        waveformSelect.value = preset.waveform;
        volumeSlider.value = preset.volume;
        volumeValue.textContent = preset.volume.toFixed(2);
        reverbSlider.value = preset.reverb;
        reverbValue.textContent = preset.reverb.toFixed(2);
        delaySlider.value = preset.delay;
        delayValue.textContent = preset.delay.toFixed(2);
        distortionSlider.value = preset.distortion;
        distortionValue.textContent = preset.distortion.toFixed(2);
        
        // Update current settings
        currentSettings = {...preset};
        
        // Apply settings to audio nodes
        masterGainNode.gain.value = preset.volume;
        distortionNode.curve = makeDistortionCurve(preset.distortion * 400);
        
        // Update any active oscillators
        Object.keys(activeOscillators).forEach(note => {
            const oscillator = activeOscillators[note].oscillator;
            oscillator.type = preset.waveform;
        });
        
        // Update delay gain
        if (delayNode._feedbackGain) {
            delayNode._feedbackGain.gain.value = preset.delay * 0.8;
        }
        
        // Update reverb
        reverbNode.gain.value = 1 + preset.reverb * 2;
    }
}

function savePreset() {
    // For a real app, you'd save this to localStorage or a backend
    alert('In a full application, this would save the current settings as a preset.');
    console.log('Current settings to save:', currentSettings);
}

// Play and stop notes
function playNote(note) {
    // Resume audio context if suspended (autoplay policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    // Return if note is already playing
    if (activeOscillators[note]) return;
    
    // Create oscillator
    const oscillator = audioContext.createOscillator();
    oscillator.type = currentSettings.waveform;
    oscillator.frequency.value = noteFrequencies[note];
    
    // Create gain node for this note (for envelope)
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;
    
    // Connect: oscillator -> gain -> master
    oscillator.connect(gainNode);
    gainNode.connect(masterGainNode);
    
    // Start oscillator
    oscillator.start();
    
    // Apply attack envelope
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(1, audioContext.currentTime + 0.01);
    
    // Store active oscillator and gain node
    activeOscillators[note] = { oscillator, gainNode };
    
    // Add active class to key
    const keyElement = document.querySelector(`.key[data-note="${note}"]`);
    if (keyElement) {
        keyElement.classList.add('active');
    }
}

function stopNote(note) {
    const activeNote = activeOscillators[note];
    if (!activeNote) return;
    
    const { oscillator, gainNode } = activeNote;
    
    // Apply release envelope
    gainNode.gain.setValueAtTime(gainNode.gain.value, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
    
    // Stop oscillator after release
    setTimeout(() => {
        oscillator.stop();
        delete activeOscillators[note];
    }, 100);
    
    // Remove active class from key
    const keyElement = document.querySelector(`.key[data-note="${note}"]`);
    if (keyElement) {
        keyElement.classList.remove('active');
    }
}

// Handle keyboard input
function handleKeyDown(event) {
    if (event.repeat) return; // Prevent repeat events when key is held
    
    const note = keyboardMap[event.key.toLowerCase()];
    if (note) {
        playNote(note);
    }
}

function handleKeyUp(event) {
    const note = keyboardMap[event.key.toLowerCase()];
    if (note) {
        stopNote(note);
    }
}

// Visualizer drawing
function drawVisualizer() {
    // Get frequency data
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);
    
    // Clear canvas
    visualizerContext.clearRect(0, 0, visualizer.width, visualizer.height);
    
    // Set line style
    visualizerContext.lineWidth = 2;
    visualizerContext.strokeStyle = '#66fcf1';
    
    // Start path
    visualizerContext.beginPath();
    
    const sliceWidth = visualizer.width / bufferLength;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * visualizer.height / 2;
        
        if (i === 0) {
            visualizerContext.moveTo(x, y);
        } else {
            visualizerContext.lineTo(x, y);
        }
        
        x += sliceWidth;
    }
    
    visualizerContext.lineTo(visualizer.width, visualizer.height / 2);
    visualizerContext.stroke();
    
    // Call next frame
    requestAnimationFrame(drawVisualizer);
}

// Utility function for distortion
function makeDistortionCurve(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    
    for (let i = 0; i < samples; ++i) {
        const x = (i * 2) / samples - 1;
        curve[i] = (3 + amount) * x * 20 * deg / (Math.PI + amount * Math.abs(x));
    }
    
    return curve;
}
