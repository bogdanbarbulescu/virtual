// --- START OF FILE virtual-main/script.js ---
document.addEventListener('DOMContentLoaded', () => {
    let audioContext;
    let masterGain;
    let analyser;
    let visualizerCanvas, visualizerCtx;
    let reverbNode, delayNode, distortionNode; // Effect nodes
    let reverbGain, delayGain, distortionGain; // Gain nodes to control effect mix/presence

    // Store oscillator nodes and their gain nodes, keyed by note frequency
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

            // Effects Chain Nodes
            distortionNode = audioContext.createWaveShaper();
            distortionGain = audioContext.createGain(); // Controls 'wetness' or presence
            makeDistortionCurve(0); // Initialize curve

            delayNode = audioContext.createDelay(1.0); // Max 1 sec delay
            // const delayFeedback = audioContext.createGain(); // For feedback loop if implemented
            delayGain = audioContext.createGain(); // Controls 'wetness' or presence
            // delayFeedback.gain.setValueAtTime(0.5, audioContext.currentTime); // Example feedback

            reverbGain = audioContext.createGain(); // Controls 'wetness' or presence
            // Reverb Node (Convolver) would go here if an impulse response was available

            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;

            // --- Connect Nodes ---
            // IMPORTANT: For now, we connect the note's envelope gain DIRECTLY to the analyser
            // in playNote() to bypass the effects chain for debugging the "no sound" issue.
            // The connections below set up the effects chain itself, but it's not used by default.
            // If sound works after bypassing, we'll revisit this routing.

            // Potential Effects Chain Routing (Input -> Distortion -> Delay -> Reverb -> Output)
            distortionNode.connect(distortionGain);
            distortionGain.connect(delayGain); // Connect distortion output to delay input (via its gain control)
            delayGain.connect(reverbGain);     // Connect delay output to reverb input (via its gain control)
            reverbGain.connect(analyser);      // Connect reverb output to analyser

            // Final mandatory connections
            analyser.connect(masterGain);
            masterGain.connect(audioContext.destination);

            // Set initial effect gain levels based on config (though they are bypassed initially)
            distortionGain.gain.setValueAtTime(config.effects.distortion > 0 ? 1 : 0, audioContext.currentTime);
            delayGain.gain.setValueAtTime(config.effects.delay, audioContext.currentTime);
            reverbGain.gain.setValueAtTime(config.effects.reverb, audioContext.currentTime);


            // --- Add this log ---
            console.log(`AudioContext initialized. State: ${audioContext.state}. Master Gain: ${masterGain.gain.value}`);
            // --------------------

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

        // A4 = MIDI 69 = 440 Hz. MIDI note number = keyNumber + (octave + 1) * 12
        const midiNumber = keyNumber + octave * 12 + 12; // Adjust calculation slightly
        return 440 * Math.pow(2, (midiNumber - 69) / 12);
    }


    // --- Envelope ---
    function applyEnvelope(gainNode, noteStartTime) {
        if (!audioContext) return;
        const now = audioContext.currentTime;
        const { attack, decay, sustain, release } = config.envelope;
        const gainParam = gainNode.gain;

        gainParam.cancelScheduledValues(now);
        gainParam.setValueAtTime(0, noteStartTime); // Start at 0 gain
        // Attack: Ramp to 1.0 over 'attack' duration
        gainParam.linearRampToValueAtTime(1.0, noteStartTime + attack);
        // Decay: Ramp to 'sustain' level over 'decay' duration
        gainParam.linearRampToValueAtTime(sustain, noteStartTime + attack + decay);
    }

    function triggerRelease(gainNode) {
        if (!audioContext) return;
        const now = audioContext.currentTime;
        const { release } = config.envelope;
        const gainParam = gainNode.gain;
        const currentGain = gainParam.value; // Get current gain value at the time of release

        gainParam.cancelScheduledValues(now); // Cancel any future ramps (like decay)
        gainParam.setValueAtTime(currentGain, now); // Hold current gain level
        // Release: Ramp down to (near) zero over 'release' duration
        gainParam.linearRampToValueAtTime(0.0001, now + release); // Ramp to a very small value close to zero
    }

    // --- Oscillator Creation ---
    function createOscillator(frequency, type, detuneValue, gainValue) {
        if (!audioContext) return null;
        const osc = audioContext.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, audioContext.currentTime);
        osc.detune.setValueAtTime(detuneValue, audioContext.currentTime);

        const gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(gainValue, audioContext.currentTime);

        osc.connect(gainNode);

        return { osc, gainNode };
    }

    // --- Sound Playback ---
    function playNote(note, startTime = audioContext.currentTime) {
        // --- Add this log ---
        console.log(`playNote called for: ${note}. AudioContext state: ${audioContext?.state}`);
        // --------------------

        if (!audioContext) {
             console.error("AudioContext not available!");
             return;
        }
        // Resume context if needed (important for user interaction start)
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                 console.log("AudioContext resumed by playNote.");
                 // Re-calculate start time after resume potentially?
                 startTime = audioContext.currentTime;
            });
        }

        const frequency = noteToFrequency(note);
        if (!frequency) {
            console.error(`Could not calculate frequency for note: ${note}`);
            return;
        }

        // Prevent re-triggering if note is already playing (simple monophonic)
        if (activeOscillators[note]) {
           console.log(`Note ${note} already playing, stopping previous instance.`);
           stopNote(note, startTime); // Stop the old one immediately before starting new
        }

        const noteEnvelopeGain = audioContext.createGain();
        applyEnvelope(noteEnvelopeGain, startTime);

        // --- DEBUGGING STEP: Connect envelope directly to analyser, bypassing effects ---
        noteEnvelopeGain.connect(analyser);
        console.log(`Connecting note ${note} envelope gain directly to analyser.`);
        // --- Original connection (to re-enable effects later):
        // noteEnvelopeGain.connect(distortionNode); // Connect envelope output to first effect
        // console.log(`Connecting note ${note} envelope gain to distortionNode.`);
        // --------------------------------------------------------------------------

        const osc1Data = createOscillator(frequency, config.osc1.type, config.osc1.detune, config.osc1.gain);
        const osc2Data = createOscillator(frequency, config.osc2.type, config.osc2.detune, config.osc2.gain);

        if (!osc1Data || !osc2Data) {
            console.error(`Failed to create oscillators for note ${note}`);
            return;
        }

        osc1Data.gainNode.connect(noteEnvelopeGain);
        osc2Data.gainNode.connect(noteEnvelopeGain);

        try {
            osc1Data.osc.start(startTime);
            osc2Data.osc.start(startTime);
        } catch (e) {
            console.error(`Error starting oscillators for note ${note}:`, e);
            // Clean up if start fails
             osc1Data.gainNode.disconnect();
             osc2Data.gainNode.disconnect();
             noteEnvelopeGain.disconnect();
            return;
        }


        activeOscillators[note] = {
            osc1: osc1Data.osc,
            osc2: osc2Data.osc,
            osc1Gain: osc1Data.gainNode,
            osc2Gain: osc2Data.gainNode,
            envelopeGain: noteEnvelopeGain,
            startTime: startTime
        };
        console.log(`Started oscillators for note ${note}`);

        // Add visual feedback to keyboard
        const keyElement = document.querySelector(`.key[data-note="${note}"]`);
        if (keyElement) keyElement.classList.add('active');
    }

    function stopNote(note, stopTime = audioContext.currentTime) {
        if (!activeOscillators[note] || !audioContext) return;
        console.log(`Stopping note: ${note}`);

        const { osc1, osc2, envelopeGain } = activeOscillators[note];
        const releaseTime = config.envelope.release;

        triggerRelease(envelopeGain);

        // Schedule oscillators to stop after the release phase ends
        const actualStopTime = stopTime + releaseTime;
        osc1.stop(actualStopTime);
        osc2.stop(actualStopTime);

        // Clean up references and disconnect nodes after the note has fully stopped
        setTimeout(() => {
            if (activeOscillators[note]) { // Check if it still exists (wasn't retriggered)
                try {
                    osc1.disconnect();
                    osc2.disconnect();
                    activeOscillators[note].osc1Gain.disconnect();
                    activeOscillators[note].osc2Gain.disconnect();
                    envelopeGain.disconnect();
                } catch(e) {
                    console.warn("Error during node disconnection (might be harmless if already disconnected):", e);
                }
                delete activeOscillators[note];
                console.log(`Cleaned up nodes for note ${note}`);
            }
        }, releaseTime * 1000 + 100); // Add a buffer (e.g., 100ms) after release ends

        // Remove visual feedback
        const keyElement = document.querySelector(`.key[data-note="${note}"]`);
        if (keyElement) keyElement.classList.remove('active');
    }

    // --- UI Update Functions ---
    function updateOscillator(oscNum, param, value) {
        if (!audioContext) return;
        const configOsc = config[`osc${oscNum}`];
        if (!configOsc) return;

        // Update the config object
        if (param === 'detune') {
             configOsc[param] = parseInt(value, 10);
        } else if (param === 'gain') {
             configOsc[param] = parseFloat(value);
        } else {
             configOsc[param] = value; // e.g., type
        }
        console.log(`Updated config.osc${oscNum}.${param} = ${configOsc[param]}`);


        // Update any currently playing notes using this oscillator parameter
        for (const note in activeOscillators) {
            const activeNote = activeOscillators[note];
            const oscNode = activeNote[`osc${oscNum}`];
            const gainNode = activeNote[`osc${oscNum}Gain`]; // Gain specific to this osc within the note

            if (oscNode) {
                if (param === 'type') {
                    oscNode.type = value;
                     console.log(`Changed playing note ${note} osc${oscNum} type to ${value}`);
                } else if (param === 'detune') {
                    // Use setTargetAtTime for smoother detune changes if desired, but setValueAtTime is simpler
                    oscNode.detune.setValueAtTime(configOsc[param], audioContext.currentTime);
                     console.log(`Changed playing note ${note} osc${oscNum} detune to ${configOsc[param]}`);
                }
            }
             if (gainNode && param === 'gain') {
                 gainNode.gain.setValueAtTime(configOsc[param], audioContext.currentTime);
                 console.log(`Changed playing note ${note} osc${oscNum} gain to ${configOsc[param]}`);
             }
        }
    }

    function updateEnvelope(param, value) {
        config.envelope[param] = parseFloat(value);
        console.log(`Updated config.envelope.${param} = ${config.envelope[param]}`);
        // Envelope changes only affect new notes or the release phase of existing ones
    }

    function updateMasterVolume(value) {
        config.masterVolume = parseFloat(value);
        console.log(`Updated config.masterVolume = ${config.masterVolume}`);
        if (masterGain && audioContext) {
            masterGain.gain.setValueAtTime(config.masterVolume, audioContext.currentTime);
        }
    }

    function updateEffect(effectName, value) {
         if (!audioContext) return;
         config.effects[effectName] = parseFloat(value);
         console.log(`Updated config.effects.${effectName} = ${config.effects[effectName]}`);

         // Find the corresponding gain node (assumes global vars named like reverbGain, delayGain)
         const gainNode = window[`${effectName}Gain`];

         if (gainNode) {
             if (effectName === 'distortion') {
                 makeDistortionCurve(value * 100); // Update curve based on slider
                 // Control the presence/mix of distortion via its gain node
                 // Set gain to 1 if distortion > 0, else 0 (simple on/off mix)
                 const distortionMix = value > 0.01 ? 1 : 0;
                 gainNode.gain.setValueAtTime(distortionMix, audioContext.currentTime);
                 console.log(`Updated distortion curve amount: ${value * 100}, mix gain: ${distortionMix}`);
             } else {
                 // For delay/reverb, the gain node controls the wet signal level (mix)
                 gainNode.gain.setValueAtTime(value, audioContext.currentTime);
                 console.log(`Updated ${effectName} mix gain to ${value}`);
             }
         } else {
             console.warn(`Effect gain node not found for: ${effectName}Gain`);
         }
    }

    // --- Distortion Curve ---
    function makeDistortionCurve(amount) {
        if (!distortionNode) return;
        const k = typeof amount === 'number' ? amount : 50; // Default amount if needed
        const n_samples = 44100; // Standard sample rate is often enough
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        let i = 0;
        let x;
        // Simple arctan distortion curve
        for (; i < n_samples; ++i) {
            x = i * 2 / n_samples - 1; // Map i to [-1, 1] range
            curve[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x)); // Formula for arctan-like curve
            // Ensure the output is roughly in the [-1, 1] range if needed, though WaveShaper handles it
            // curve[i] = Math.atan(x * k) / Math.atan(k); // Alternative atan curve
        }
        distortionNode.curve = curve;
        distortionNode.oversample = '4x'; // Improves quality, reduces aliasing
    }


    // --- Visualizer ---
    function setupVisualizer() {
        visualizerCanvas = document.getElementById('visualizer');
        if (!visualizerCanvas) {
            console.error("Visualizer canvas not found!");
            return;
        }
        visualizerCtx = visualizerCanvas.getContext('2d');
        if (!visualizerCtx) {
             console.error("Could not get 2D context for visualizer canvas!");
             return;
        }
        // Set canvas dimensions based on its CSS size to avoid scaling issues
        visualizerCanvas.width = visualizerCanvas.clientWidth;
        visualizerCanvas.height = visualizerCanvas.clientHeight;
        drawVisualizer(); // Start the drawing loop
    }

    function drawVisualizer() {
        requestAnimationFrame(drawVisualizer); // Loop the drawing

        if (!analyser || !visualizerCtx || !visualizerCanvas || !audioContext || audioContext.state !== 'running') {
            // Clear canvas if audio is not running or analyser not ready
            if (visualizerCtx && visualizerCanvas) {
                 visualizerCtx.fillStyle = '#0b0c10'; // Background color from CSS
                 visualizerCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
            }
            return; // Don't draw if analyser isn't ready or context isn't running
        }

        const bufferLength = analyser.frequencyBinCount; // Represents the number of data points available
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
    }

    // --- Sequencer ---
    function setupSequencer() {
        const grid = document.querySelector('.sequence-grid');
        if (!grid) {
            console.error("Sequencer grid not found!");
            return;
        }
        config.sequencer.notes.forEach(note => {
            config.sequencer.steps[note] = Array(8).fill(false); // Initialize steps for each note
            const row = grid.querySelector(`.sequence-row[data-note="${note}"]`);
            if (row) {
                const buttons = row.querySelectorAll('.step');
                buttons.forEach((button, index) => {
                    // Ensure data-step attribute is set if not already
                    if (!button.hasAttribute('data-step')) {
                        button.setAttribute('data-step', index);
                    }
                    button.addEventListener('click', () => {
                        toggleStep(note, index, button);
                    });
                });
            } else {
                console.warn(`Sequencer row not found for note: ${note}`);
            }
        });
    }

    function toggleStep(note, stepIndex, buttonElement) {
        config.sequencer.steps[note][stepIndex] = !config.sequencer.steps[note][stepIndex];
        buttonElement.classList.toggle('active', config.sequencer.steps[note][stepIndex]);
        console.log(`Sequencer step toggled: Note ${note}, Step ${stepIndex}, Active: ${config.sequencer.steps[note][stepIndex]}`);
    }

    function playSequence() {
        if (!audioContext) {
            console.error("Cannot play sequence, AudioContext not ready.");
            return;
        }
        if (config.sequencer.isPlaying) {
            console.log("Sequence already playing.");
            return;
        }

        // Resume AudioContext if it was suspended
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log("AudioContext resumed by playSequence.");
                startSequencerTiming();
            });
        } else {
            startSequencerTiming();
        }
    }

    function startSequencerTiming() {
        console.log("Starting sequence playback.");
        config.sequencer.isPlaying = true;
        config.sequencer.currentStep = 0; // Start from the beginning
        const secondsPerBeat = 60.0 / config.sequencer.tempo;
        // Assuming 8 steps represent 2 beats (e.g., 8th notes if 4/4 time)
        const secondsPerStep = secondsPerBeat / 4; // Adjust if steps represent different subdivisions

        let nextStepTime = audioContext.currentTime; // Schedule the first step immediately

        function scheduleNextStep() {
            if (!config.sequencer.isPlaying) return; // Stop scheduling if sequence stopped

            // Calculate the time window for scheduling
            const lookahead = 0.1; // How far ahead to schedule (seconds)
            const scheduleAheadTime = audioContext.currentTime + lookahead;

            // Schedule all steps within the lookahead window
            while (nextStepTime < scheduleAheadTime && config.sequencer.isPlaying) {
                const stepTime = nextStepTime; // Time this step should play
                const stepToPlay = config.sequencer.currentStep;

                // Play notes for the current step
                config.sequencer.notes.forEach(note => {
                    if (config.sequencer.steps[note][stepToPlay]) {
                        console.log(`Sequencer playing note ${note} at step ${stepToPlay}, time ${stepTime}`);
                        playNote(note, stepTime);
                        // Automatically stop the note after roughly one step duration (minus a tiny bit)
                        // This provides basic note length control for the sequencer.
                        stopNote(note, stepTime + secondsPerStep * 0.95);
                    }
                });

                 // Schedule visual update slightly ahead of audio event using setTimeout
                 const visualDelay = (stepTime - audioContext.currentTime) * 1000;
                 setTimeout(() => updateStepIndicator(stepToPlay), Math.max(0, visualDelay - 10)); // Update slightly before audio if possible


                // Advance to the next step and calculate its time
                nextStepTime += secondsPerStep;
                config.sequencer.currentStep = (stepToPlay + 1) % 8; // 8 steps loop
            }

            // Re-schedule the next check using setTimeout for better accuracy than setInterval
            config.sequencer.intervalId = setTimeout(scheduleNextStep, lookahead * 250); // Check 4 times per lookahead period
        }

        scheduleNextStep(); // Start the scheduling loop

        document.getElementById('play-sequence').textContent = 'Playing...'; // Update button text/state
        document.getElementById('play-sequence').disabled = true;
        document.getElementById('stop-sequence').disabled = false;
    }


    function stopSequence() {
        if (!config.sequencer.isPlaying) return;
        console.log("Stopping sequence playback.");

        config.sequencer.isPlaying = false;
        if (config.sequencer.intervalId) {
            clearTimeout(config.sequencer.intervalId);
            config.sequencer.intervalId = null;
        }
        // Clear visual indicator immediately
        updateStepIndicator(-1); // -1 indicates no step is current

        // Stop any notes potentially triggered by the sequencer that might still be in release phase
        // This might cut notes abruptly, depending on desired behaviour.
        // config.sequencer.notes.forEach(note => {
        //     if (activeOscillators[note] && activeOscillators[note].startTime >= (audioContext.currentTime - 1)) { // Heuristic: stop notes started recently by seq
        //         stopNote(note);
        //     }
        // });

        document.getElementById('play-sequence').textContent = 'Play';
        document.getElementById('play-sequence').disabled = false;
        document.getElementById('stop-sequence').disabled = true;
    }

     function updateStepIndicator(stepIndex) {
        // Debounce or throttle this if it causes performance issues
        requestAnimationFrame(() => {
            const steps = document.querySelectorAll('.step');
            steps.forEach(step => step.classList.remove('current'));

            if (stepIndex >= 0) {
                const currentSteps = document.querySelectorAll(`.step[data-step="${stepIndex}"]`);
                currentSteps.forEach(step => step.classList.add('current'));
            }
        });
    }

    function updateTempo(bpm) {
        const newTempo = parseInt(bpm, 10);
        if (isNaN(newTempo)) return;
        config.sequencer.tempo = newTempo;
        document.getElementById('tempo-value').textContent = bpm;
        console.log(`Tempo updated to ${bpm} BPM`);
        // If playing, the change will be picked up by the scheduler implicitly
        // as it recalculates secondsPerStep based on the updated config.sequencer.tempo.
        // No need to restart unless a hard restart is desired.
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
    // Store initial config as 'default' preset after initial setup
    function captureDefaultPreset() {
        presets.default = JSON.parse(JSON.stringify({ // Deep copy current state
             osc1: config.osc1,
             osc2: config.osc2,
             envelope: config.envelope,
             effects: config.effects,
             masterVolume: config.masterVolume
        }));
        console.log("Captured default preset state.");
    }


    function loadPreset(presetName) {
        const preset = presets[presetName];
        if (!preset) {
            console.error(`Preset "${presetName}" not found.`);
            return;
        }
        console.log(`Loading preset: ${presetName}`);

        // Update config object (create copies to avoid modifying preset object)
        config.osc1 = { ...preset.osc1 };
        config.osc2 = { ...preset.osc2 };
        config.envelope = { ...preset.envelope };
        config.effects = { ...preset.effects };
        config.masterVolume = preset.masterVolume;

        // Update UI elements to reflect the loaded preset
        updateUIFromConfig();

        // Apply loaded settings to audio engine immediately
        applyConfigToAudioEngine();
    }

    function updateUIFromConfig() {
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

        console.log("UI updated from config.");
    }

    function applyConfigToAudioEngine() {
         if (!audioContext) return;
         // Apply settings that affect the overall audio graph or currently playing notes
         updateMasterVolume(config.masterVolume);
         updateEffect('reverb', config.effects.reverb);
         updateEffect('delay', config.effects.delay);
         updateEffect('distortion', config.effects.distortion);

         // Update oscillators for any currently playing notes
         updateOscillator(1, 'type', config.osc1.type);
         updateOscillator(1, 'detune', config.osc1.detune);
         updateOscillator(1, 'gain', config.osc1.gain);
         updateOscillator(2, 'type', config.osc2.type);
         updateOscillator(2, 'detune', config.osc2.detune);
         updateOscillator(2, 'gain', config.osc2.gain);
         console.log("Audio engine updated from config.");
    }


    function saveCurrentPreset() {
        const presetName = prompt("Enter a name for your preset:", "My Preset");
        if (!presetName || presetName.trim() === "") {
            alert("Preset name cannot be empty.");
            return;
        }
        const trimmedName = presetName.trim();

        // Create a deep copy of the relevant parts of the current config
        const currentSettings = JSON.parse(JSON.stringify({
             osc1: config.osc1,
             osc2: config.osc2,
             envelope: config.envelope,
             effects: config.effects,
             masterVolume: config.masterVolume
        }));

        // Add/Update in presets object
        presets[trimmedName] = currentSettings;

        // Add/Update in select dropdown
        const select = document.getElementById('preset-select');
        let existingOption = select.querySelector(`option[value="${trimmedName}"]`);
        if (!existingOption) {
            const option = document.createElement('option');
            option.value = trimmedName;
            option.textContent = trimmedName;
            select.appendChild(option);
            existingOption = option;
        }
        select.value = trimmedName; // Select the newly saved preset

        // Optionally save all presets (including the new one) to localStorage
        savePresetsToLocalStorage();
        alert(`Preset "${trimmedName}" saved!`);
    }

    function savePresetsToLocalStorage() {
         try {
            // Only save non-default presets to avoid saving the initial state repeatedly? Or save all?
            // Let's save all for simplicity.
            localStorage.setItem('customSynthPresets', JSON.stringify(presets));
            console.log("Presets saved to localStorage.");
        } catch (e) {
            console.error("Error saving presets to localStorage:", e);
            alert("Could not save preset to local storage (maybe storage is full or disabled).");
        }
    }

    function loadCustomPresets() {
         try {
            const savedPresets = localStorage.getItem('customSynthPresets');
            if (savedPresets) {
                const loadedPresets = JSON.parse(savedPresets);
                const select = document.getElementById('preset-select');

                // Merge loaded presets into the main presets object
                // Be careful about overwriting built-ins if names clash
                for (const name in loadedPresets) {
                    if (!presets.hasOwnProperty(name)) { // Only add if it's not a built-in name
                         presets[name] = loadedPresets[name];
                    } else if (name !== 'default') { // Allow overwriting custom presets, but maybe not bass/lead/pad?
                         presets[name] = loadedPresets[name]; // Or decide on merging strategy
                    }
                }


                // Clear existing custom options (keep default, bass, lead, pad)
                Array.from(select.options).forEach(option => {
                    if (!['default', 'bass', 'lead', 'pad'].includes(option.value)) {
                        select.remove(option.index);
                    }
                });

                // Add loaded/merged custom presets to dropdown
                for (const name in presets) {
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
        console.log("Setting up event listeners...");

        // --- Oscillator Tabs ---
        const oscTabs = document.querySelectorAll('.osc-tab');
        const oscPanels = document.querySelectorAll('.oscillator-panel');
        oscTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                oscTabs.forEach(t => t.classList.remove('active'));
                oscPanels.forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const panelId = `${tab.dataset.osc}-panel`;
                const panel = document.getElementById(panelId);
                if (panel) {
                    panel.classList.add('active');
                } else {
                    console.error(`Oscillator panel not found: ${panelId}`);
                }
            });
        });

        // --- Input/Slider Value Display Updates ---
        function setupValueDisplay(inputId, displayId) {
            const input = document.getElementById(inputId);
            const display = document.getElementById(displayId);
            if (input && display) {
                input.addEventListener('input', () => {
                    display.textContent = input.value;
                });
                // Initial display update
                display.textContent = input.value;
            } else {
                 console.warn(`Could not find input/display pair: ${inputId} / ${displayId}`);
            }
        }

        // Oscillators
        document.getElementById('waveform1')?.addEventListener('change', (e) => updateOscillator(1, 'type', e.target.value));
        document.getElementById('detune1')?.addEventListener('input', (e) => updateOscillator(1, 'detune', e.target.value));
        setupValueDisplay('detune1', 'detune1-value');
        document.getElementById('osc1-gain')?.addEventListener('input', (e) => updateOscillator(1, 'gain', e.target.value));
        setupValueDisplay('osc1-gain', 'osc1-gain-value');

        document.getElementById('waveform2')?.addEventListener('change', (e) => updateOscillator(2, 'type', e.target.value));
        document.getElementById('detune2')?.addEventListener('input', (e) => updateOscillator(2, 'detune', e.target.value));
        setupValueDisplay('detune2', 'detune2-value');
        document.getElementById('osc2-gain')?.addEventListener('input', (e) => updateOscillator(2, 'gain', e.target.value));
        setupValueDisplay('osc2-gain', 'osc2-gain-value');

        // Envelope
        document.getElementById('attack')?.addEventListener('input', (e) => updateEnvelope('attack', e.target.value));
        setupValueDisplay('attack', 'attack-value');
        document.getElementById('decay')?.addEventListener('input', (e) => updateEnvelope('decay', e.target.value));
        setupValueDisplay('decay', 'decay-value');
        document.getElementById('sustain')?.addEventListener('input', (e) => updateEnvelope('sustain', e.target.value));
        setupValueDisplay('sustain', 'sustain-value');
        document.getElementById('release')?.addEventListener('input', (e) => updateEnvelope('release', e.target.value));
        setupValueDisplay('release', 'release-value');

        // Effects
        document.getElementById('reverb')?.addEventListener('input', (e) => updateEffect('reverb', e.target.value));
        setupValueDisplay('reverb', 'reverb-value');
        document.getElementById('delay')?.addEventListener('input', (e) => updateEffect('delay', e.target.value));
        setupValueDisplay('delay', 'delay-value');
        document.getElementById('distortion')?.addEventListener('input', (e) => updateEffect('distortion', e.target.value));
        setupValueDisplay('distortion', 'distortion-value');

        // Master Volume
        document.getElementById('volume')?.addEventListener('input', (e) => updateMasterVolume(e.target.value));
        setupValueDisplay('volume', 'volume-value');

        // --- Keyboard Interaction ---
        const keys = document.querySelectorAll('.key');
        keys.forEach(key => {
            const note = key.dataset.note;
            if (!note) return;

            // Helper to resume context on interaction
            const ensureAudioContextResumed = () => {
                if (audioContext && audioContext.state === 'suspended') {
                    audioContext.resume().then(() => console.log("AudioContext resumed by key interaction."));
                }
            };

            // Mouse Interaction
            key.addEventListener('mousedown', (e) => {
                ensureAudioContextResumed();
                playNote(note);
                e.preventDefault(); // Prevent potential text selection
            });
            key.addEventListener('mouseup', () => stopNote(note));
            key.addEventListener('mouseleave', () => {
                 // Only stop if the note is actually playing (check activeOscillators)
                 if (activeOscillators[note]) {
                    stopNote(note);
                 }
            });

             // Touch Interaction
             key.addEventListener('touchstart', (e) => {
                 ensureAudioContextResumed();
                 playNote(note);
                 e.preventDefault(); // Prevent mouse event emulation and scrolling
             }, { passive: false }); // Need passive: false to call preventDefault

             key.addEventListener('touchend', (e) => {
                 stopNote(note);
                 e.preventDefault();
             });
        });

        // Computer Keyboard Mapping
        const keyMap = {
            'a': 'C4', 'w': 'C#4', 's': 'D4', 'e': 'D#4', 'd': 'E4',
            'f': 'F4', 't': 'F#4', 'g': 'G4', 'y': 'G#4', 'h': 'A4',
            'u': 'A#4', 'j': 'B4', 'k': 'C5', 'o': 'C#5', 'l': 'D5',
            'p': 'D#5', ';': 'E5', '\'': 'F5' // Added F5 for apostrophe key
        };
        const pressedKeys = new Set(); // Track pressed keys to prevent auto-repeat issues

        document.addEventListener('keydown', (e) => {
            // Ignore if modifier keys are pressed (e.g., Cmd+R, Ctrl+S)
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            const key = e.key.toLowerCase();
            const note = keyMap[key];

            if (note && !pressedKeys.has(note)) {
                 // Resume AudioContext on first interaction if needed
                if (audioContext && audioContext.state === 'suspended') {
                    audioContext.resume().then(() => console.log("AudioContext resumed by keydown."));
                }
                playNote(note);
                pressedKeys.add(note); // Mark key as pressed
                // Prevent default browser action for keys used by synth (e.g., space, arrows if mapped)
                // if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
                //    e.preventDefault();
                // }
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
        document.getElementById('play-sequence')?.addEventListener('click', playSequence);
        document.getElementById('stop-sequence')?.addEventListener('click', stopSequence);
        document.getElementById('tempo')?.addEventListener('input', (e) => updateTempo(e.target.value));
        setupValueDisplay('tempo', 'tempo-value');
        // Initial state for sequencer buttons
        const stopButton = document.getElementById('stop-sequence');
        if (stopButton) stopButton.disabled = true;


        // --- Preset Controls ---
        document.getElementById('load-preset')?.addEventListener('click', () => {
            const select = document.getElementById('preset-select');
            if (select) {
                loadPreset(select.value);
            }
        });
        document.getElementById('save-preset')?.addEventListener('click', saveCurrentPreset);

        console.log("Event listeners set up complete.");
    }

    // --- Initialization ---
    function init() {
        console.log("Initializing Synthesizer...");
        if (!initAudio()) {
            // Don't proceed if audio context failed
            console.error("Synth initialization failed due to AudioContext error.");
            return;
        }
        setupVisualizer(); // Setup visualizer after audio context
        setupSequencer(); // Setup sequencer logic
        setupEventListeners(); // Setup UI interactions
        loadCustomPresets(); // Load saved presets from localStorage
        captureDefaultPreset(); // Capture the initial state as the 'default' preset
        loadPreset('default'); // Load default settings initially (updates UI and Engine)
        console.log("Synthesizer Initialized successfully.");
    }

    // Start the application once the DOM is ready
    init();

});
// --- END OF FILE virtual-main/script.js ---