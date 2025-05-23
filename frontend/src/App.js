import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import axios from 'axios';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Voice Personas
const VOICE_PERSONAS = {
  "calm_female": {
    "name": "Serene Sarah",
    "description": "Calm and nurturing female voice",
    "color": "from-purple-400 to-pink-400"
  },
  "wise_male": {
    "name": "Mindful Marcus", 
    "description": "Deep and reassuring male voice",
    "color": "from-blue-400 to-indigo-400"
  },
  "gentle_guide": {
    "name": "Peaceful Priya",
    "description": "Gentle and guiding voice",
    "color": "from-green-400 to-teal-400"
  },
  "nature_spirit": {
    "name": "Forest Finn",
    "description": "Natural and earthy voice",
    "color": "from-emerald-400 to-green-400"
  },
  "zen_master": {
    "name": "Tranquil Tara",
    "description": "Wise and centered voice",
    "color": "from-amber-400 to-orange-400"
  }
};

// Meditation Categories
const MEDITATION_CATEGORIES = {
  "rainfall": {
    "name": "Rainfall/Thunder",
    "icon": "🌧️",
    "description": "Soothing rain and thunder sounds"
  },
  "ocean": {
    "name": "Ocean Waves", 
    "icon": "🌊",
    "description": "Calming ocean and wave sounds"
  },
  "forest": {
    "name": "Forest/Nature",
    "icon": "🌲",
    "description": "Peaceful forest and bird songs"
  },
  "whitenoise": {
    "name": "White Noise",
    "icon": "🎵",
    "description": "Focus-enhancing ambient sounds"
  },
  "tibetan": {
    "name": "Tibetan Bowls",
    "icon": "🎎",
    "description": "Sacred singing bowls and bells"
  }
};

// Breathing Exercise Component
const BreathingVisualization = ({ isActive, breathingPattern }) => {
  const [phase, setPhase] = useState('inhale'); // inhale, hold, exhale
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    if (!isActive) return;
    
    const patterns = {
      '4-4-6': { inhale: 4, hold: 4, exhale: 6 },
      '4-7-8': { inhale: 4, hold: 7, exhale: 8 },
      'box': { inhale: 4, hold: 4, exhale: 4, hold2: 4 }
    };
    
    const pattern = patterns[breathingPattern] || patterns['4-4-6'];
    
    const timer = setInterval(() => {
      setCount(prev => {
        if (phase === 'inhale' && prev >= pattern.inhale) {
          setPhase('hold');
          return 0;
        } else if (phase === 'hold' && prev >= pattern.hold) {
          setPhase('exhale');
          return 0;
        } else if (phase === 'exhale' && prev >= pattern.exhale) {
          setPhase('inhale');
          return 0;
        }
        return prev + 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [isActive, breathingPattern, phase]);
  
  const getBreathingSize = () => {
    if (phase === 'inhale') return 'scale-150';
    if (phase === 'hold') return 'scale-125';
    return 'scale-100';
  };
  
  const getBreathingColor = () => {
    if (phase === 'inhale') return 'bg-blue-400';
    if (phase === 'hold') return 'bg-purple-400';
    return 'bg-green-400';
  };
  
  return (
    <div className="flex flex-col items-center space-y-4">
      <motion.div 
        className={`w-32 h-32 rounded-full ${getBreathingColor()} opacity-70 transition-all duration-1000 ${getBreathingSize()}`}
        animate={{
          scale: phase === 'inhale' ? 1.5 : phase === 'hold' ? 1.25 : 1,
        }}
        transition={{ duration: 1, ease: "easeInOut" }}
      />
      <div className="text-center text-white">
        <p className="text-xl font-semibold capitalize">{phase}</p>
        <p className="text-sm opacity-75">{count}</p>
      </div>
    </div>
  );
};

// Voice Visualization Component
const VoiceVisualization = ({ isListening, isSpeaking }) => {
  return (
    <div className="flex justify-center items-center space-x-2">
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          className={`w-2 bg-gradient-to-t ${
            isListening ? 'from-green-400 to-green-600' : 
            isSpeaking ? 'from-blue-400 to-blue-600' : 
            'from-gray-400 to-gray-600'
          } rounded-full`}
          animate={{
            height: isListening || isSpeaking ? [20, 40, 20] : 20,
          }}
          transition={{
            duration: 0.8,
            repeat: isListening || isSpeaking ? Infinity : 0,
            delay: i * 0.1,
          }}
        />
      ))}
    </div>
  );
};

function App() {
  // State management
  const [currentSession, setCurrentSession] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState('calm_female');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [musicTracks, setMusicTracks] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [sessionDuration, setSessionDuration] = useState(60);
  const [breathingActive, setBreathingActive] = useState(false);
  const [breathingPattern, setBreathingPattern] = useState('4-4-6');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Audio elements
  const audioRef = useRef(null);
  const wsRef = useRef(null);
  
  // Speech recognition
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition
  } = useSpeechRecognition();
  
  // Voice commands
  const commands = [
    {
      command: ['start breathing', 'begin breathing exercise', 'breathing'],
      callback: () => startBreathingExercise()
    },
    {
      command: ['stop breathing', 'end breathing'],
      callback: () => setBreathingActive(false)
    },
    {
      command: ['play music', 'start music'],
      callback: () => playSelectedMusic()
    },
    {
      command: ['pause music', 'stop music'],
      callback: () => pauseMusic()
    },
    {
      command: ['end session', 'finish'],
      callback: () => endSession()
    }
  ];
  
  // Initialize session
  const startSession = async () => {
    try {
      setIsLoading(true);
      
      const response = await axios.post(`${BACKEND_URL}/api/session`, {
        voice_persona: selectedVoice,
        session_type: 'guided_meditation',
        duration_minutes: sessionDuration,
        ambient_category: selectedCategory
      });
      
      setCurrentSession(response.data);
      setIsSessionActive(true);
      
      // Initialize WebSocket connection
      const wsUrl = `${BACKEND_URL.replace('https:', 'wss:').replace('http:', 'ws:')}/api/meditation-session/${response.data.id}`;
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setMessages(prev => [...prev, { type: 'system', content: 'Connected to meditation session' }]);
      };
      
      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      };
      
      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setMessages(prev => [...prev, { type: 'error', content: 'Connection error' }]);
      };
      
      // Start speech recognition
      SpeechRecognition.startListening({ continuous: true });
      
    } catch (error) {
      console.error('Failed to start session:', error);
      setMessages(prev => [...prev, { type: 'error', content: 'Failed to start session' }]);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Handle WebSocket messages
  const handleWebSocketMessage = (data) => {
    console.log('Received message:', data);
    
    if (data.audio) {
      // Play audio response
      playAudioFromBase64(data.audio);
    }
    
    setMessages(prev => [...prev, {
      type: data.type || 'response',
      content: data.message || data.response,
      timestamp: new Date()
    }]);
  };
  
  // Play audio from base64
  const playAudioFromBase64 = (base64Audio) => {
    try {
      const audioBlob = new Blob([
        new Uint8Array(
          atob(base64Audio)
            .split('')
            .map(char => char.charCodeAt(0))
        )
      ], { type: 'audio/wav' });
      
      const audioUrl = URL.createObjectURL(audioBlob);
      
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        audioRef.current.play();
      }
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  };
  
  // Start breathing exercise
  const startBreathingExercise = () => {
    setBreathingActive(true);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'breathing_exercise' }));
    }
  };
  
  // Load music for category
  const loadMusicForCategory = async (category) => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/music/${category}`);
      setMusicTracks(response.data.tracks);
      setSelectedCategory(category);
    } catch (error) {
      console.error('Failed to load music:', error);
    }
  };
  
  // Play selected music
  const playSelectedMusic = () => {
    if (musicTracks.length > 0 && !currentTrack) {
      setCurrentTrack(musicTracks[0]);
    }
  };
  
  // Pause music
  const pauseMusic = () => {
    setCurrentTrack(null);
  };
  
  // End session
  const endSession = () => {
    setIsSessionActive(false);
    setBreathingActive(false);
    setCurrentTrack(null);
    
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ command: 'end_session' }));
      wsRef.current.close();
    }
    
    SpeechRecognition.stopListening();
    setCurrentSession(null);
    setMessages([]);
  };
  
  // Send voice input when transcript changes
  useEffect(() => {
    if (transcript && isSessionActive && wsRef.current) {
      const audioBlob = new Blob([transcript], { type: 'text/plain' });
      // In a real implementation, you'd convert the transcript to audio
      // For now, we'll send it as text
      console.log('User said:', transcript);
      resetTranscript();
    }
  }, [transcript, isSessionActive, resetTranscript]);
  
  if (!browserSupportsSpeechRecognition) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-center">
          <h1 className="text-2xl mb-4">Browser doesn't support speech recognition.</h1>
          <p>Please use Chrome or Edge for the full experience.</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
        <div className="absolute top-3/4 right-1/4 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
        <div className="absolute bottom-1/4 left-1/2 w-96 h-96 bg-indigo-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-4000"></div>
      </div>
      
      <div className="relative z-10 min-h-screen flex">
        {/* Left Panel - Voice Agent */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="glassmorphic rounded-3xl p-8 max-w-md w-full text-center">
            {/* Voice Agent Avatar */}
            <div className="mb-8">
              <motion.div 
                className={`w-32 h-32 mx-auto rounded-full bg-gradient-to-r ${VOICE_PERSONAS[selectedVoice].color} flex items-center justify-center text-4xl font-bold text-white shadow-2xl`}
                animate={{
                  scale: listening ? [1, 1.1, 1] : 1,
                  boxShadow: listening ? 
                    ['0 0 0 0 rgba(59, 130, 246, 0.7)', '0 0 0 20px rgba(59, 130, 246, 0)', '0 0 0 0 rgba(59, 130, 246, 0)'] :
                    '0 10px 25px rgba(0, 0, 0, 0.3)'
                }}
                transition={{
                  duration: listening ? 1.5 : 0.3,
                  repeat: listening ? Infinity : 0
                }}
              >
                {VOICE_PERSONAS[selectedVoice].name.split(' ').map(name => name[0]).join('')}
              </motion.div>
            </div>
            
            <h2 className="text-2xl font-bold text-white mb-2">
              {VOICE_PERSONAS[selectedVoice].name}
            </h2>
            <p className="text-purple-200 mb-6">
              {VOICE_PERSONAS[selectedVoice].description}
            </p>
            
            {/* Voice Visualization */}
            <div className="mb-6">
              <VoiceVisualization 
                isListening={listening && isSessionActive}
                isSpeaking={false}
              />
            </div>
            
            {/* Status */}
            <div className="text-sm text-purple-200 mb-4">
              {isSessionActive ? (
                listening ? 'Listening...' : 'Ready to help'
              ) : 'Ready to start'}
            </div>
            
            {/* Breathing Exercise */}
            {breathingActive && (
              <div className="mt-6">
                <BreathingVisualization 
                  isActive={breathingActive}
                  breathingPattern={breathingPattern}
                />
              </div>
            )}
          </div>
          
          {/* Session Messages */}
          {messages.length > 0 && (
            <div className="mt-6 glassmorphic rounded-2xl p-4 max-w-md w-full max-h-40 overflow-y-auto">
              {messages.slice(-3).map((message, index) => (
                <div key={index} className={`text-sm mb-2 ${
                  message.type === 'error' ? 'text-red-300' : 'text-white'
                }`}>
                  {message.content}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Right Panel - Controls */}
        <div className="w-96 p-8 space-y-6">
          {!isSessionActive ? (
            // Session Setup
            <>
              {/* Voice Selection */}
              <div className="glassmorphic rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white mb-4">Choose Your Guide</h3>
                <div className="space-y-3">
                  {Object.entries(VOICE_PERSONAS).map(([key, persona]) => (
                    <button
                      key={key}
                      onClick={() => setSelectedVoice(key)}
                      className={`w-full p-3 rounded-xl text-left transition-all ${
                        selectedVoice === key
                          ? 'bg-white bg-opacity-20 border-2 border-white border-opacity-30'
                          : 'bg-white bg-opacity-10 hover:bg-opacity-20'
                      }`}
                    >
                      <div className="text-white font-semibold">{persona.name}</div>
                      <div className="text-purple-200 text-sm">{persona.description}</div>
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Session Duration */}
              <div className="glassmorphic rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white mb-4">Session Length</h3>
                <div className="flex space-x-3">
                  {[15, 30, 60].map(duration => (
                    <button
                      key={duration}
                      onClick={() => setSessionDuration(duration)}
                      className={`flex-1 p-3 rounded-xl transition-all ${
                        sessionDuration === duration
                          ? 'bg-white bg-opacity-20 border-2 border-white border-opacity-30'
                          : 'bg-white bg-opacity-10 hover:bg-opacity-20'
                      } text-white`}
                    >
                      {duration} min
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Meditation Categories */}
              <div className="glassmorphic rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white mb-4">Ambient Sounds</h3>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(MEDITATION_CATEGORIES).map(([key, category]) => (
                    <button
                      key={key}
                      onClick={() => loadMusicForCategory(key)}
                      className={`p-4 rounded-xl text-center transition-all ${
                        selectedCategory === key
                          ? 'bg-white bg-opacity-20 border-2 border-white border-opacity-30'
                          : 'bg-white bg-opacity-10 hover:bg-opacity-20'
                      }`}
                    >
                      <div className="text-2xl mb-1">{category.icon}</div>
                      <div className="text-white text-sm font-semibold">{category.name}</div>
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Start Button */}
              <button
                onClick={startSession}
                disabled={isLoading}
                className="w-full glassmorphic rounded-2xl p-6 text-white font-bold text-xl hover:bg-white hover:bg-opacity-20 transition-all disabled:opacity-50"
              >
                {isLoading ? 'Starting...' : 'Begin Meditation'}
              </button>
            </>
          ) : (
            // Session Controls
            <>
              {/* Session Info */}
              <div className="glassmorphic rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white mb-2">Active Session</h3>
                <div className="text-purple-200 text-sm">
                  <p>Duration: {sessionDuration} minutes</p>
                  <p>Guide: {VOICE_PERSONAS[selectedVoice].name}</p>
                  {selectedCategory && (
                    <p>Sounds: {MEDITATION_CATEGORIES[selectedCategory].name}</p>
                  )}
                </div>
              </div>
              
              {/* Breathing Controls */}
              <div className="glassmorphic rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white mb-4">Breathing Exercise</h3>
                <div className="space-y-3">
                  <div className="flex space-x-2">
                    {['4-4-6', '4-7-8', 'box'].map(pattern => (
                      <button
                        key={pattern}
                        onClick={() => setBreathingPattern(pattern)}
                        className={`flex-1 p-2 rounded-lg text-sm transition-all ${
                          breathingPattern === pattern
                            ? 'bg-white bg-opacity-20'
                            : 'bg-white bg-opacity-10 hover:bg-opacity-20'
                        } text-white`}
                      >
                        {pattern}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setBreathingActive(!breathingActive)}
                    className={`w-full p-3 rounded-xl transition-all ${
                      breathingActive
                        ? 'bg-red-500 bg-opacity-20 hover:bg-opacity-30'
                        : 'bg-green-500 bg-opacity-20 hover:bg-opacity-30'
                    } text-white`}
                  >
                    {breathingActive ? 'Stop Breathing' : 'Start Breathing'}
                  </button>
                </div>
              </div>
              
              {/* Music Controls */}
              {musicTracks.length > 0 && (
                <div className="glassmorphic rounded-2xl p-6">
                  <h3 className="text-xl font-bold text-white mb-4">Ambient Music</h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {musicTracks.map((track, index) => (
                      <button
                        key={track.id}
                        onClick={() => setCurrentTrack(track)}
                        className={`w-full p-3 rounded-lg text-left transition-all ${
                          currentTrack?.id === track.id
                            ? 'bg-white bg-opacity-20'
                            : 'bg-white bg-opacity-10 hover:bg-opacity-20'
                        }`}
                      >
                        <div className="text-white text-sm font-semibold truncate">{track.name}</div>
                        <div className="text-purple-200 text-xs truncate">{track.artist}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Session Controls */}
              <div className="space-y-3">
                <button
                  onClick={() => {
                    if (wsRef.current) {
                      wsRef.current.send(JSON.stringify({ command: 'check_in' }));
                    }
                  }}
                  className="w-full glassmorphic rounded-xl p-4 text-white hover:bg-white hover:bg-opacity-20 transition-all"
                >
                  Request Check-in
                </button>
                
                <button
                  onClick={endSession}
                  className="w-full bg-red-500 bg-opacity-20 rounded-xl p-4 text-white hover:bg-opacity-30 transition-all"
                >
                  End Session
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Audio element for playing responses */}
      <audio ref={audioRef} style={{ display: 'none' }} />
      
      {/* Music player */}
      {currentTrack && currentTrack.preview_url && (
        <div className="fixed bottom-4 left-4 glassmorphic rounded-xl p-4 max-w-sm">
          <div className="text-white text-sm font-semibold mb-2">Now Playing</div>
          <div className="text-purple-200 text-xs mb-2">{currentTrack.name} - {currentTrack.artist}</div>
          <audio
            src={currentTrack.preview_url}
            controls
            autoPlay
            loop
            className="w-full"
            style={{ height: '30px' }}
          />
        </div>
      )}
    </div>
  );
}

export default App;