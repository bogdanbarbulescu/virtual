// --- START OF FILE virtual-main/script.js ---
document.addEventListener('DOMContentLoaded', () => {
    let audioContext;
    let masterGain;
    let analyser;
    let visualizerCanvas, visualizerCtx;
    let reverbNode, delayNode, distortionNode; // Placeholder for effects
    let reverbGain, delayGain, distortionGain; // Gain nodes to control effect mix

    // Store oscillator nodes and their gain nodes, keyed by note frequency for polyphony/note management
    const activeOscillators = {};

    // --- Configuration & State ---
    const config = {
        osc1: {
            type: 'sine',
            detune: 0,
            gain: 0.5
        },
        osc2: {
            type: 'sine',
            detune: 0,
            gain: 0.5
        },
        envelope: {
            attack: 0.01,
            decay: 0.1,
            sustain: 0.7,
            release: 0.1
        },
        effects: {
            reverb: 0,
            delay: 0,
            distortion: 0
        },
        masterVolume: 0.5,
        sequencer: {
            tempo: 120,
            isPlaying: false,
            steps: {}, // Store sequence data like { 'C5': [false, false, ...], 'A4': [...] }
            currentStep: 0,
            intervalId: null,
            notes: ['C5', 'A4', 'G4', 'E4', 'C4'] // Match HTML
        }
    };

    // --- Web Audio API Setup ---
    function initAudio() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = audioContext.createGain();
            masterGain.gain.setValueAtTime(config.masterVolume, audioContext.currentTime);

            // Effects Chain (placeholders/gain controls)
            // Distortion -> Delay -> Reverb -> Analyser -> Master Gain -> Destination
            distortionNode = audioContext.createWaveShaper();
            distortionGain = audioContext.createGain();
            distortionGain.gain.setValueAtTime(config.effects.distortion > 0 ? 1 : 0, audioContext.currentTime); // Initial gain based on distortion amount
            makeDistortionCurve(0); // Initialize curve

            delayNode = audioContext.createDelay(1.0); // Max 1 sec delay
            const delayFeedback = audioContext.createGain();
            delayGain = audioContext.createGain(); // Controls wet/dry mix conceptually
            delayGain.gain.setValueAtTime(config.effects.delay, audioContext.currentTime);
            delayFeedback.gain.setValueAtTime(0.5, audioContext.currentTime); // Example feedback

            // Simple Delay routing: input -> delayNode -> feedback -> delayNode ... ; input -> delayGain -> output
            // delayNode.connect(delayFeedback);
            // delayFeedback.connect(delayNode); // Feedback loop - careful with levels!
            // For simplicity, we'll just control a gain node representing delay mix for now.

            reverbGain = audioContext.createGain(); // Controls wet/dry mix conceptually
            reverbGain.gain.setValueAtTime(config.effects.reverb, audioContext.currentTime);
            // Reverb Node (Convolver) would go here if an impulse response was available

            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;

            // Connect nodes (Simplified chain for now)
            // We connect individual note outputs to effects chain later
            // Effects nodes connect sequentially, then to analyser, then master gain
            distortionNode.connect(distortionGain);
            // delayNode.connect(delayGain); // Connect actual delay if implemented fully
            // reverbNode.connect(reverbGain); // Connect actual reverb if implemented fully

            // Connect effect gain stages (representing mix) in sequence
            distortionGain.connect(delayGain);
            delayGain.connect(reverbGain);
            reverbGain.connect(analyser); // Connect last effect stage to analyser
            analyser.connect(masterGain);
            masterGain.connect(audioContext.destination);

            console.log("AudioContext initialized successfully.");
            return true;

        } catch (e) {
            console.error("Error initializing Web Audio API:", e);
            alert("Web Audio API is not supported in this browser or initialization failed.");
            return false;
        }
    }

    // --- Note Frequency Calculation ---
    function noteToFrequency(note) {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = parseInt(note.slice(-1));
        const keyNumber = notes.indexOf(note.slice(0, -1));

        if (keyNumber < 0) return null;

        const midiNumber = keyNumber + (octave + 1) * 12;
        return 440 * Math.pow(2, (midiNumber - 69) / 12);
    }

    // --- Envelope ---
    function applyEnvelope(gainNode, noteStartTime) {
        const now = audioContext.currentTime;
        const { attack, decay, sustain, release } = config.envelope;
        const gainParam = gainNode.gain;

        gainParam.cancelScheduledValues(now);
        gainParam.setValueAtTime(0, noteStartTime); // Start at 0
        // Attack
        gainParam.linearRampToValueAtTime(1.0, noteStartTime + attack);
        // Decay to Sustain level
        gainParam.linearRampToValueAtTime(sustain, noteStartTime + attack + decay);

        // Release is handled in stopNote
    }

    function triggerRelease(gainNode) {
        const now = audioContext.currentTime;
        const { release } = config.envelope;
        const gainParam = gainNode.gain;
        const currentGain = gainParam.value; // Get current gain value

        gainParam.cancelScheduledValues(now);
        gainParam.setValueAtTime(currentGain, now); // Hold current gain
        gainParam.linearRampToValueAtTime(0, now + release); // Release ramp
    }

    // --- Oscillator Creation ---
    function createOscillator(frequency, type, detuneValue, gainValue) {
        const osc = audioContext.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, audioContext.currentTime);
        osc.detune.setValueAtTime(detuneValue, audioContext.currentTime);

        const gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(gainValue, audioContext.currentTime);

        osc.connect(gainNode);
        // We connect the gainNode to the effects chain/master gain later in playNote

        return { osc, gainNode };
    }

    // --- Sound Playback ---
    function playNote(note, startTime = audioContext.currentTime) {
        const frequency = noteToFrequency(note);
        if (!frequency || !audioContext) return;

        // Prevent re-triggering if note is already playing (simple monophonic/retrigger logic)
        if (activeOscillators[note]) {
           // Optionally stop the existing note first for retrigger effect
           // stopNote(note);
           // Or just return to avoid retriggering
           return;
        }

        const noteEnvelopeGain = audioContext.createGain();
        applyEnvelope(noteEnvelopeGain, startTime);

        // Connect envelope output to the start of the effects chain (or directly to analyser/master if no effects)
        // For simplicity, connecting directly to analyser for now. Effects need more complex routing.
        // A better approach involves a summing node before effects.
        // Let's connect to distortion node input
        noteEnvelopeGain.connect(distortionNode); // Connect envelope output to first effect

        const osc1Data = createOscillator(frequency, config.osc1.type, config.osc1.detune, config.osc1.gain);
        const osc2Data = createOscillator(frequency, config.osc2.type, config.osc2.detune, config.osc2.gain);

        osc1Data.gainNode.connect(noteEnvelopeGain);
        osc2Data.gainNode.connect(noteEnvelopeGain);

        osc1Data.osc.start(startTime);
        osc2Data.osc.start(startTime);

        activeOscillators[note] = {
            osc1: osc1Data.osc,
            osc2: osc2Data.osc,
            osc1Gain: osc1Data.gainNode,
            osc2Gain: osc2Data.gainNode,
            envelopeGain: noteEnvelopeGain,
            startTime: startTime
        };

        // Add visual feedback to keyboard
        const keyElement = document.querySelector(`.key[data-note="${note}"]`);
        if (keyElement) keyElement.classList.add('active');
    }

    function stopNote(note, stopTime = audioContext.currentTime) {
        if (!activeOscillators[note] || !audioContext) return;

        const { osc1, osc2, envelopeGain } = activeOscillators[note];
        const releaseTime = config.envelope.release;

        triggerRelease(envelopeGain);

        // Stop oscillators after the release phase ends
        const actualStopTime = stopTime + releaseTime;
        osc1.stop(actualStopTime);
        osc2.stop(actualStopTime);

        // Clean up after the note has fully stopped
        setTimeout(() => {
            // Disconnect nodes to free up resources
             if (activeOscillators[note]) { // Check if it wasn't stopped/retriggered quickly
                osc1.disconnect();
                osc2.disconnect();
                activeOscillators[note].osc1Gain.disconnect();
                activeOscillators[note].osc2Gain.disconnect();
                envelopeGain.disconnect();
                delete activeOscillators[note];
             }
        }, releaseTime * 1000 + 50); // Add a small buffer

        // Remove visual feedback
        const keyElement = document.querySelector(`.key[data-note="${note}"]`);
        if (keyElement) keyElement.classList.remove('active');
    }

    // --- UI Update Functions ---
    function updateOscillator(oscNum, param, value) {
        const configOsc = config[`osc${oscNum}`];
        configOsc[param] = value;

        // Update any currently playing notes using this oscillator parameter
        for (const note in activeOscillators) {
            const activeNote = activeOscillators[note];
            const oscNode = activeNote[`osc${oscNum}`];
            const gainNode = activeNote[`osc${oscNum}Gain`]; // Gain specific to this osc within the note

            if (oscNode) {
                if (param === 'type') {
                    oscNode.type = value;
                } else if (param === 'detune') {
                    oscNode.detune.setValueAtTime(value, audioContext.currentTime);
                }
            }
             if (gainNode && param === 'gain') {
                 gainNode.gain.setValueAtTime(value, audioContext.currentTime);
             }
        }
    }

    function updateEnvelope(param, value) {
        config.envelope[param] = parseFloat(value);
    }

    function updateMasterVolume(value) {
        config.masterVolume = parseFloat(value);
        if (masterGain) {
            masterGain.gain.setValueAtTime(config.masterVolume, audioContext.currentTime);
        }
    }

    function updateEffect(effectName, value) {
         config.effects[effectName] = parseFloat(value);
         const gainNode = window[`${effectName}Gain`]; // Access global gain nodes like reverbGain, delayGain etc.

         if (gainNode) {
             // For distortion, we might want to change the curve instead of just gain
             if (effectName === 'distortion') {
                 makeDistortionCurve(value * 100); // Scale value for curve amount
                 // Also control the 'wetness' via gain
                 distortionGain.gain.setValueAtTime(value > 0 ? 1 : 0, audioContext.currentTime); // Simple on/off based on slider
             } else {
                 // For delay/reverb, this gain controls the 'wet' signal level (mix)
                 gainNode.gain.setValueAtTime(value, audioContext.currentTime);
             }
         }
    }

    // --- Distortion Curve ---
    function makeDistortionCurve(amount) {
        if (!distortionNode) return;
        const k = typeof amount === 'number' ? amount : 50; // Default amount
        const n_samples = 44100; // Standard sample rate
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        let i = 0;
        let x;
        for (; i < n_samples; ++i) {
            x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        distortionNode.curve = curve;
        distortionNode.oversample = '4x';
    }


    // --- Visualizer ---
    function setupVisualizer() {
        visualizerCanvas = document.getElementById('visualizer');
        visualizerCtx = visualizerCanvas.getContext('2d');
        drawVisualizer();
    }

    function drawVisualizer() {
        if (!analyser || !visualizerCtx || !visualizerCanvas) {
            requestAnimationFrame(drawVisualizer); // Keep trying if not ready
            return;
        }

        const bufferLength = analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength); // Use Uint8Array for time domain data

        analyser.getByteTimeDomainData(dataArray); // Get waveform data

        visualizerCtx.fillStyle = '#0b0c10'; // Background color from CSS
        visualizerCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

        visualizerCtx.lineWidth = 2;
        visualizerCtx.strokeStyle = '#66fcf1'; // Line color from CSS
        visualizerCtx.beginPath();

        const sliceWidth = visualizerCanvas.width * 1.0 / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0; // Normalize data (0-255 -> 0.0-2.0)
            const y = v * visualizerCanvas.height / 2;

            if (i === 0) {
                visualizerCtx.moveTo(x, y);
            } else {
                visualizerCtx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        visualizerCtx.lineTo(visualizerCanvas.width, visualizerCanvas.height / 2);
        visualizerCtx.stroke();

        requestAnimationFrame(drawVisualizer); // Loop the drawing
    }

    // --- Sequencer ---
    function setupSequencer() {
        const grid = document.querySelector('.sequence-grid');
        config.sequencer.notes.forEach(note => {
            config.sequencer.steps[note] = Array(8).fill(false); // Initialize steps for each note
            const row = grid.querySelector(`.sequence-row[data-note="${note}"]`);
            if (row) {
                const buttons = row.querySelectorAll('.step');
                buttons.forEach((button, index) => {
                    button.addEventListener('click', () => {
                        toggleStep(note, index, button);
                    });
                });
            }
        });
    }

    function toggleStep(note, stepIndex, buttonElement) {
        config.sequencer.steps[note][stepIndex] = !config.sequencer.steps[note][stepIndex];
        buttonElement.classList.toggle('active', config.sequencer.steps[note][stepIndex]);
    }

    function playSequence() {
        if (!audioContext || config.sequencer.isPlaying) return;

        // Resume AudioContext if it was suspended
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        config.sequencer.isPlaying = true;
        config.sequencer.currentStep = 0;
        const secondsPerBeat = 60.0 / config.sequencer.tempo;
        const secondsPerStep = secondsPerBeat / 4; // Assuming 16th notes per beat, 8 steps = 2 beats

        // Clear previous interval if any
        if (config.sequencer.intervalId) {
            clearInterval(config.sequencer.intervalId);
        }

        function scheduleStep() {
            const lookahead = 0.1; // How far ahead to schedule (in seconds)
            const scheduleAheadTime = audioContext.currentTime + lookahead;

            while (nextStepTime < scheduleAheadTime) {
                 // Calculate the time for the current step
                const stepTime = nextStepTime; // Use pre-calculated time

                // Play notes for the current step
                config.sequencer.notes.forEach(note => {
                    if (config.sequencer.steps[note][config.sequencer.currentStep]) {
                        playNote(note, stepTime);
                        // Automatically stop the note shortly after, e.g., duration of a step
                        // Note: This simple approach doesn't respect the envelope release fully.
                        // A more robust sequencer would manage note lengths.
                        stopNote(note, stepTime + secondsPerStep * 0.9); // Stop slightly before next step
                    }
                });

                // Update visual indicator for the current step
                updateStepIndicator(config.sequencer.currentStep);


                // Advance to the next step and calculate its time
                config.sequencer.currentStep = (config.sequencer.currentStep + 1) % 8; // 8 steps
                nextStepTime += secondsPerStep;
            }

             // Re-schedule the next check
            config.sequencer.intervalId = setTimeout(scheduleStep, lookahead * 500); // Check slightly less than half the lookahead time
        }

        let nextStepTime = audioContext.currentTime; // Start scheduling immediately
        scheduleStep(); // Start the scheduling loop

        document.getElementById('play-sequence').textContent = 'Pause'; // Or disable play, enable stop
    }


    function stopSequence() {
        if (!config.sequencer.isPlaying) return;

        config.sequencer.isPlaying = false;
        if (config.sequencer.intervalId) {
            clearTimeout(config.sequencer.intervalId);
            config.sequencer.intervalId = null;
        }
        // Clear visual indicator
        updateStepIndicator(-1); // -1 indicates no step is current

        // Stop any lingering notes (optional, depends on desired behavior)
        // for (const note in activeOscillators) {
        //     stopNote(note);
        // }

        document.getElementById('play-sequence').textContent = 'Play';
    }

     function updateStepIndicator(stepIndex) {
        const steps = document.querySelectorAll('.step');
        steps.forEach(step => step.classList.remove('current'));

        if (stepIndex >= 0) {
            const currentSteps = document.querySelectorAll(`.step[data-step="${stepIndex}"]`);
            currentSteps.forEach(step => step.classList.add('current'));
        }
    }

    function updateTempo(bpm) {
        config.sequencer.tempo = parseInt(bpm, 10);
        document.getElementById('tempo-value').textContent = bpm;
        // If playing, restart the sequence with the new tempo
        if (config.sequencer.isPlaying) {
            stopSequence();
            playSequence();
        }
    }

    // --- Presets ---
    const presets = {
        default: { /* Will be populated by initial config */ },
        bass: {
            osc1: { type: 'square', detune: -5, gain: 0.6 },
            osc2: { type: 'sawtooth', detune: 5, gain: 0.4 },
            envelope: { attack: 0.02, decay: 0.3, sustain: 0.1, release: 0.2 },
            effects: { reverb: 0.1, delay: 0, distortion: 0.1 },
            masterVolume: 0.6
        },
        lead: {
            osc1: { type: 'sawtooth', detune: -10, gain: 0.5 },
            osc2: { type: 'square', detune: 10, gain: 0.5 },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.4 },
            effects: { reverb: 0.3, delay: 0.4, distortion: 0 },
            masterVolume: 0.5
        },
        pad: {
            osc1: { type: 'sine', detune: -7, gain: 0.5 },
            osc2: { type: 'triangle', detune: 7, gain: 0.5 },
            envelope: { attack: 0.8, decay: 1.5, sustain: 0.8, release: 1.0 },
            effects: { reverb: 0.6, delay: 0.2, distortion: 0 },
            masterVolume: 0.4
        }
    };
    // Store initial config as 'default' preset
    presets.default = JSON.parse(JSON.stringify(config)); // Deep copy

    function loadPreset(presetName) {
        const preset = presets[presetName];
        if (!preset) return;

        // Update config object
        config.osc1 = { ...preset.osc1 };
        config.osc2 = { ...preset.osc2 };
        config.envelope = { ...preset.envelope };
        config.effects = { ...preset.effects };
        config.masterVolume = preset.masterVolume;

        // Update UI elements to reflect the loaded preset
        // Oscillators
        document.getElementById('waveform1').value = config.osc1.type;
        document.getElementById('detune1').value = config.osc1.detune;
        document.getElementById('detune1-value').textContent = config.osc1.detune;
        document.getElementById('osc1-gain').value = config.osc1.gain;
        document.getElementById('osc1-gain-value').textContent = config.osc1.gain;

        document.getElementById('waveform2').value = config.osc2.type;
        document.getElementById('detune2').value = config.osc2.detune;
        document.getElementById('detune2-value').textContent = config.osc2.detune;
        document.getElementById('osc2-gain').value = config.osc2.gain;
        document.getElementById('osc2-gain-value').textContent = config.osc2.gain;

        // Envelope
        document.getElementById('attack').value = config.envelope.attack;
        document.getElementById('attack-value').textContent = config.envelope.attack;
        document.getElementById('decay').value = config.envelope.decay;
        document.getElementById('decay-value').textContent = config.envelope.decay;
        document.getElementById('sustain').value = config.envelope.sustain;
        document.getElementById('sustain-value').textContent = config.envelope.sustain;
        document.getElementById('release').value = config.envelope.release;
        document.getElementById('release-value').textContent = config.envelope.release;

        // Effects
        document.getElementById('reverb').value = config.effects.reverb;
        document.getElementById('reverb-value').textContent = config.effects.reverb;
        document.getElementById('delay').value = config.effects.delay;
        document.getElementById('delay-value').textContent = config.effects.delay;
        document.getElementById('distortion').value = config.effects.distortion;
        document.getElementById('distortion-value').textContent = config.effects.distortion;

        // Master Volume
        document.getElementById('volume').value = config.masterVolume;
        document.getElementById('volume-value').textContent = config.masterVolume;

        // Apply loaded settings to audio engine immediately
        updateMasterVolume(config.masterVolume);
        updateEffect('reverb', config.effects.reverb);
        updateEffect('delay', config.effects.delay);
        updateEffect('distortion', config.effects.distortion);
        // Oscillator settings are applied dynamically when notes play or via updateOscillator if needed immediately
    }

    function saveCurrentPreset() {
        const presetName = prompt("Enter a name for your preset:", "My Preset");
        if (!presetName) return;

        // Create a deep copy of the current config
        const currentSettings = JSON.parse(JSON.stringify(config));

        // Add to presets object
        presets[presetName] = currentSettings;

        // Add to select dropdown
        const select = document.getElementById('preset-select');
        const option = document.createElement('option');
        option.value = presetName;
        option.textContent = presetName;
        select.appendChild(option);

        // Optionally save to localStorage
        try {
            localStorage.setItem('customPresets', JSON.stringify(presets));
            alert(`Preset "${presetName}" saved!`);
        } catch (e) {
            console.error("Error saving presets to localStorage:", e);
            alert("Could not save preset to local storage (maybe storage is full or disabled).");
        }
    }

    function loadCustomPresets() {
         try {
            const savedPresets = localStorage.getItem('customPresets');
            if (savedPresets) {
                const customPresets = JSON.parse(savedPresets);
                const select = document.getElementById('preset-select');
                // Merge saved presets, potentially overwriting defaults if names match
                Object.assign(presets, customPresets);

                // Clear existing custom options (keep default, bass, lead, pad)
                Array.from(select.options).forEach(option => {
                    if (!['default', 'bass', 'lead', 'pad'].includes(option.value)) {
                        select.remove(option.index);
                    }
                });

                // Add loaded custom presets to dropdown
                for (const name in customPresets) {
                    if (!['default', 'bass', 'lead', 'pad'].includes(name)) {
                         const option = document.createElement('option');
                         option.value = name;
                         option.textContent = name;
                         select.appendChild(option);
                    }
                }
                console.log("Custom presets loaded from localStorage.");
            }
        } catch (e) {
            console.error("Error loading presets from localStorage:", e);
        }
    }


    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // --- Oscillator Tabs ---
        const oscTabs = document.querySelectorAll('.osc-tab');
        const oscPanels = document.querySelectorAll('.oscillator-panel');
        oscTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                oscTabs.forEach(t => t.classList.remove('active'));
                oscPanels.forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`${tab.dataset.osc}-panel`).classList.add('active');
            });
        });

        // --- Oscillator 1 Controls ---
        document.getElementById('waveform1').addEventListener('change', (e) => updateOscillator(1, 'type', e.target.value));
        document.getElementById('detune1').addEventListener('input', (e) => {
            updateOscillator(1, 'detune', parseInt(e.target.value, 10));
            document.getElementById('detune1-value').textContent = e.target.value;
        });
         document.getElementById('osc1-gain').addEventListener('input', (e) => {
            updateOscillator(1, 'gain', parseFloat(e.target.value));
            document.getElementById('osc1-gain-value').textContent = e.target.value;
        });

        // --- Oscillator 2 Controls ---
        document.getElementById('waveform2').addEventListener('change', (e) => updateOscillator(2, 'type', e.target.value));
        document.getElementById('detune2').addEventListener('input', (e) => {
            updateOscillator(2, 'detune', parseInt(e.target.value, 10));
            document.getElementById('detune2-value').textContent = e.target.value;
        });
         document.getElementById('osc2-gain').addEventListener('input', (e) => {
            updateOscillator(2, 'gain', parseFloat(e.target.value));
            document.getElementById('osc2-gain-value').textContent = e.target.value;
        });

        // --- Envelope Controls ---
        document.getElementById('attack').addEventListener('input', (e) => {
            updateEnvelope('attack', e.target.value);
            document.getElementById('attack-value').textContent = e.target.value;
        });
        document.getElementById('decay').addEventListener('input', (e) => {
            updateEnvelope('decay', e.target.value);
            document.getElementById('decay-value').textContent = e.target.value;
        });
        document.getElementById('sustain').addEventListener('input', (e) => {
            updateEnvelope('sustain', e.target.value);
            document.getElementById('sustain-value').textContent = e.target.value;
        });
        document.getElementById('release').addEventListener('input', (e) => {
            updateEnvelope('release', e.target.value);
            document.getElementById('release-value').textContent = e.target.value;
        });

        // --- Effects Controls ---
        document.getElementById('reverb').addEventListener('input', (e) => {
            updateEffect('reverb', e.target.value);
            document.getElementById('reverb-value').textContent = e.target.value;
        });
        document.getElementById('delay').addEventListener('input', (e) => {
            updateEffect('delay', e.target.value);
            document.getElementById('delay-value').textContent = e.target.value;
        });
        document.getElementById('distortion').addEventListener('input', (e) => {
            updateEffect('distortion', e.target.value);
            document.getElementById('distortion-value').textContent = e.target.value;
        });

        // --- Master Volume ---
        document.getElementById('volume').addEventListener('input', (e) => {
            updateMasterVolume(e.target.value);
            document.getElementById('volume-value').textContent = e.target.value;
        });

        // --- Keyboard Interaction ---
        const keys = document.querySelectorAll('.key');
        keys.forEach(key => {
            const note = key.dataset.note;
            // Mouse/Touch Interaction
            key.addEventListener('mousedown', () => playNote(note));
            key.addEventListener('mouseup', () => stopNote(note));
            key.addEventListener('mouseleave', () => {
                 // Only stop if the mouse button is *not* pressed down anymore
                 // This requires tracking mouse state, complex. Simpler: stop on mouseleave.
                 if (activeOscillators[note]) {
                    stopNote(note);
                 }
            });
             key.addEventListener('touchstart', (e) => {
                 e.preventDefault(); // Prevent mouse event emulation
                 playNote(note);
             });
             key.addEventListener('touchend', (e) => {
                 e.preventDefault();
                 stopNote(note);
             });
        });

        // Computer Keyboard Mapping
        const keyMap = {
            'a': 'C4', 'w': 'C#4', 's': 'D4', 'e': 'D#4', 'd': 'E4',
            'f': 'F4', 't': 'F#4', 'g': 'G4', 'y': 'G#4', 'h': 'A4',
            'u': 'A#4', 'j': 'B4', 'k': 'C5', 'o': 'C#5', 'l': 'D5',
            'p': 'D#5', ';': 'E5'
            // Add more mappings if needed
        };
        const pressedKeys = new Set(); // Track pressed keys to prevent auto-repeat issues

        document.addEventListener('keydown', (e) => {
            const note = keyMap[e.key.toLowerCase()];
            if (note && !pressedKeys.has(note)) {
                 // Resume AudioContext on first interaction if needed
                if (audioContext && audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                playNote(note);
                pressedKeys.add(note); // Mark key as pressed
            }
        });

        document.addEventListener('keyup', (e) => {
            const note = keyMap[e.key.toLowerCase()];
            if (note) {
                stopNote(note);
                pressedKeys.delete(note); // Mark key as released
            }
        });

        // --- Sequencer Controls ---
        document.getElementById('play-sequence').addEventListener('click', () => {
            if (config.sequencer.isPlaying) {
                // stopSequence(); // Let stop button handle stopping
            } else {
                playSequence();
            }
        });
        document.getElementById('stop-sequence').addEventListener('click', stopSequence);
        document.getElementById('tempo').addEventListener('input', (e) => {
            updateTempo(e.target.value);
        });

        // --- Preset Controls ---
        document.getElementById('load-preset').addEventListener('click', () => {
            const selectedPreset = document.getElementById('preset-select').value;
            loadPreset(selectedPreset);
        });
        document.getElementById('save-preset').addEventListener('click', saveCurrentPreset);

    }

    // --- Initialization ---
    function init() {
        console.log("Initializing Synthesizer...");
        if (!initAudio()) {
            // Don't proceed if audio context failed
            return;
        }
        setupVisualizer();
        setupSequencer();
        setupEventListeners();
        loadCustomPresets(); // Load saved presets from localStorage
        loadPreset('default'); // Load default settings initially
        console.log("Synthesizer Initialized.");
    }

    // Start the application
    init();

});
// --- END OF FILE virtual-main/script.js ---