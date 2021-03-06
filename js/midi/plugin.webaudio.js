/*
	----------------------------------------------------------
	Web Audio API - OGG or MPEG Soundbank
	----------------------------------------------------------
	http://webaudio.github.io/web-audio-api/
	----------------------------------------------------------
*/

(function (root) {
  'use strict';

  (window.AudioContext || window.webkitAudioContext) && (function () {
    var audioContext = null;
    var useStreamingBuffer = false; // !!audioContext.createMediaElementSource;
    var midi = root.WebAudio = {api: 'webaudio'};
    var ctx; // audio context
    var sources = {};
    var effects = {};
    var masterVolume = 127;
    var audioBuffers = {};
    var scheduled = [];
    var lookahead = 150;
    var interval = 100;
    var schedulerRunning = false;
    ///
    midi.audioBuffers = audioBuffers;
    midi.send = function (data, delay) {
    };
    midi.setController = function (channelId, type, value, delay) {
    };

    midi.setVolume = function (channelId, volume, delay) {
      if (delay) {
        setTimeout(function () {
          masterVolume = volume;
        }, delay * 1000);
      } else {
        masterVolume = volume;
      }
    };

    midi.programChange = function (channelId, program) {
      var channel = root.channels[channelId];
      channel.instrument = program;
// 			}
    };

    var pitchBend = function (channelId, program, timestamp) {
      setTimeout(function () {
        var channel = root.channels[channelId];
        channel.pitchBend = program;
      }, (timestamp - ctx.currentTime) * 1000);
    };

    midi.pitchBend = function (channelId, program, delay) {
      if ((delay || 0) > 0) {
        schedule({
          call: pitchBend,
          args: [channelId, program],
          timestamp: ctx.currentTime + delay
        });
      } else {
        pitchBend(channelId, program, ctx.currentTime)
      }
    };

    midi._noteOn = function (channelId, noteId, velocity, timestamp) {

      /// check whether the note exists
      var channel = root.channels[channelId];
      var instrument = channel.instrument;
      var bufferId = instrument + '' + noteId;
      var buffer = audioBuffers[bufferId];
      if (!buffer) {
        console.log("Instrument not found:", MIDI.GM.byId[instrument].id, instrument, channelId);
        return;
      }

      /// create audio buffer
      if (useStreamingBuffer) {
        var source = ctx.createMediaElementSource(buffer);
      } else { // XMLHTTP buffer
        var source = ctx.createBufferSource();
        source.buffer = buffer;
      }

      /// add effects to buffer
      if (effects) {
        var chain = source;
        for (var key in effects) {
          chain.connect(effects[key].input);
          chain = effects[key];
        }
      }

      /// add gain + pitchShift
      var gain = (velocity / 127) * (masterVolume / 127) * 2 - 1;
      source.connect(ctx.destination);
      source.playbackRate.value = 1; // pitch shift
      source.gainNode = ctx.createGain(); // gain
      source.gainNode.connect(ctx.destination);
      source.gainNode.gain.value = Math.min(1.0, Math.max(-1.0, gain));
      source.connect(source.gainNode);
      ///
      if (useStreamingBuffer) {
        if (timestamp) {
          return setTimeout(function () {
            buffer.currentTime = 0;
            buffer.play()
          }, (timestamp - ctx.currentTime) * 1000);
        } else {
          buffer.currentTime = 0;
          buffer.play()
        }
      } else {
        source.start(timestamp || 0);
      }
      if (sources[channelId + '' + noteId]) {
        // if notes is already played, stop that note first
        sources[channelId + '' + noteId].stop()
      }
      sources[channelId + '' + noteId] = source;
      ///
      return source;
    };

    midi.noteOn = function (channelId, noteId, velocity, delay) {
      if ((delay || 0) > 0) {
        schedule({
          call: midi._noteOn,
          args: [channelId, noteId, velocity],
          timestamp: ctx.currentTime + delay
        });
      } else {
        midi._noteOn(channelId, noteId, velocity, ctx.currentTime)
      }
    };

    midi._noteOff = function (channelId, noteId, timestamp) {
      /// check whether the note exists
      var channel = root.channels[channelId];
      var instrument = channel.instrument;
      var bufferId = instrument + '' + noteId;
      var buffer = audioBuffers[bufferId];
      if (buffer) {
        var source = sources[channelId + '' + noteId];
        if (source) {
          if (source.gainNode) {
            // @Miranet: 'the values of 0.2 and 0.3 could of course be used as
            // a 'release' parameter for ADSR like time settings.'
            // add { 'metadata': { release: 0.3 } } to soundfont files
            var gain = source.gainNode.gain;
            gain.linearRampToValueAtTime(gain.value, timestamp);
            gain.linearRampToValueAtTime(-1.0, timestamp + 0.3);
          }
          ///
          if (useStreamingBuffer) {
            if (timestamp) {
              setTimeout(function () {
                buffer.pause();
              }, (timestamp - ctx.currentTime) * 1000);
            } else {
              buffer.pause();
            }
          } else {
            if (source.noteOff) {
              source.noteOff(timestamp + 0.5);
            } else {
              source.stop(timestamp + 0.5);
            }
          }
          ///
          delete sources[channelId + '' + noteId];
          ///
          return source;
        }
      }
    };

    midi.noteOff = function (channelId, noteId, delay) {
    	if ((delay || 0) > 0) {
				schedule({
					call: midi._noteOff,
					args: [channelId, noteId],
					timestamp: ctx.currentTime + delay
				});
			} else {
    		midi._noteOff(channelId, noteId, ctx.currentTime)
			}
    };

    midi.chordOn = function (channel, chord, velocity, delay) {
      var res = {};
      for (var n = 0, note, len = chord.length; n < len; n++) {
        res[note = chord[n]] = midi.noteOn(channel, note, velocity, delay);
      }
      return res;
    };

    midi.chordOff = function (channel, chord, delay) {
      var res = {};
      for (var n = 0, note, len = chord.length; n < len; n++) {
        res[note = chord[n]] = midi.noteOff(channel, note, delay);
      }
      return res;
    };

    midi.stopAllNotes = function () {
      scheduled = [];
      for (let sid in sources) {
        sources[sid].stop(ctx.currentTime + 0.05);
      }
      for (let sid in sources) {
        // needs extra loop, other loop breaks when adding this... (don't know why)
        sources[sid].gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
      }
      sources = [];
    };

    midi.setEffects = function (list) {
      if (ctx.tunajs) {
        for (var n = 0; n < list.length; n++) {
          var data = list[n];
          var effect = new ctx.tunajs[data.type](data);
          effect.connect(ctx.destination);
          effects[data.type] = effect;
        }
      } else {
        return console.log('Effects module not installed.');
      }
    };

    midi.connect = function (opts) {
      root.setDefaultPlugin(midi);
      midi.setContext(ctx || createAudioContext(), opts.onsuccess);
    };

    midi.getContext = function () {
      return ctx;
    };

    midi.setContext = function (newCtx, onload, onprogress, onerror) {
      ctx = newCtx;

      /// tuna.js effects module - https://github.com/Dinahmoe/tuna
      if (typeof Tuna !== 'undefined' && !ctx.tunajs) {
        ctx.tunajs = new Tuna(ctx);
      }

      /// loading audio files
      var urls = [];
      var notes = root.keyToNote;
      for (var key in notes) urls.push(key);
      ///
      var waitForEnd = function (instrument) {
        for (var key in bufferPending) { // has pending items
          if (bufferPending[key]) return;
        }
        ///
        if (onload) { // run onload once
          onload();
          onload = null;
        }
      };
      ///
      var requestAudio = function (soundfont, instrumentId, index, key) {
        var url = soundfont[key];
        if (url) {
          bufferPending[instrumentId]++;
          loadAudio(url, function (buffer) {
            buffer.id = key;
            var noteId = root.keyToNote[key];
            audioBuffers[instrumentId + '' + noteId] = buffer;
            ///
            if (--bufferPending[instrumentId] === 0) {
              var percent = index / 87;
// 							console.log(MIDI.GM.byId[instrumentId], 'processing: ', percent);
              soundfont.isLoaded = true;
              waitForEnd(instrument);
            }
          }, function (err) {
            // 				console.log(err);
          });
        }
      };
      ///
      var bufferPending = {};
      for (var instrument in root.Soundfont) {
        var soundfont = root.Soundfont[instrument];
        if (soundfont.isLoaded) {
          continue;
        }
        ///
        var synth = root.GM.byName[instrument];
        var instrumentId = synth.number;
        ///
        bufferPending[instrumentId] = 0;
        ///
        for (var index = 0; index < urls.length; index++) {
          var key = urls[index];
          requestAudio(soundfont, instrumentId, index, key);
        }
      }
      ///
      setTimeout(waitForEnd, 1);
    };

    /* Load audio file: streaming | base64 | arraybuffer
    ---------------------------------------------------------------------- */
    function loadAudio(url, onload, onerror) {
      if (useStreamingBuffer) {
        var audio = new Audio();
        audio.src = url;
        audio.controls = false;
        audio.autoplay = false;
        audio.preload = false;
        audio.addEventListener('canplay', function () {
          onload && onload(audio);
        });
        audio.addEventListener('error', function (err) {
          onerror && onerror(err);
        });
        document.body.appendChild(audio);
      } else if (url.indexOf('data:audio') === 0) { // Base64 string
        var base64 = url.split(',')[1];
        var buffer = Base64Binary.decodeArrayBuffer(base64);
        ctx.decodeAudioData(buffer, onload, onerror);
      } else { // XMLHTTP buffer
        var request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.responseType = 'arraybuffer';
        request.onload = function () {
          ctx.decodeAudioData(request.response, onload, onerror);
        };
        request.send();
      }
    };

    function createAudioContext() {
      return new (window.AudioContext || window.webkitAudioContext)();
    };

    function schedule(event) {
      scheduled.push(event);
      if (!schedulerRunning) {
        schedulerRunning = true;
        doSchedule();
      }
    }

    function doSchedule() {
      for (var i = 0; i < scheduled.length; i++) {
        if (scheduled[i].timestamp < ctx.currentTime + lookahead / 1000) {
          scheduled[i].call(...scheduled[i].args, scheduled[i].timestamp);
        }
      }
      scheduled = scheduled.filter(event => event.timestamp >= ctx.currentTime + lookahead / 1000);
      if (scheduled.length > 0) {
        setTimeout(doSchedule, interval)
      } else {
        schedulerRunning = false;
      }
    }
  })();
})(MIDI);
