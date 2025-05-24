import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import axios from 'axios';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Voice Personas with enhanced therapeutic focus
const VOICE_PERSONAS = [
  {
    id: "calm_female",
    name: "Dr. Serena",
    title: "Mindful Therapist",
    description: "Calm and nurturing therapeutic voice",
    color: "from-blue-400 to-indigo-500",
    accent: "#3B82F6",
    avatar: "🧘‍♀️"
  },
  {
    id: "wise_male", 
    name: "Dr. Marcus",
    title: "Wise Counselor",
    description: "Deep and reassuring therapeutic guidance",
    color: "from-emerald-400 to-teal-500",
    accent: "#10B981",
    avatar: "🧘‍♂️"
  },
  {
    id: "gentle_guide",
    name: "Dr. Priya",
    title: "Gentle Guide",
    description: "Compassionate and understanding voice",
    color: "from-purple-400 to-pink-500",
    accent: "#8B5CF6",
    avatar: "🌸"
  },
  {
    id: "nature_spirit",
    name: "Dr. Forest",
    title: "Nature Therapist",
    description: "Grounding and earthy therapeutic presence",
    color: "from-green-400 to-emerald-500",
    accent: "#059669",
    avatar: "🌿"
  },
  {
    id: "zen_master",
    name: "Dr. Zen",
    title: "Mindfulness Expert",
    description: "Centered and peaceful guidance",
    color: "from-amber-400 to-orange-500",
    accent: "#F59E0B",
    avatar: "🕉️"
  }
];

// Meditation sounds for therapeutic sessions
const MEDITATION_SOUNDS = [
  {
    id: "nature",
    name: "Forest Sounds",
    description: "Peaceful forest with gentle birds",
    icon: "🌲",
    category: "forest"
  },
  {
    id: "water",
    name: "Ocean Waves", 
    description: "Calming ocean waves",
    icon: "🌊",
    category: "ocean"
  },
  {
    id: "rain",
    name: "Gentle Rain",
    description: "Soft rainfall for relaxation",
    icon: "🌧️",
    category: "rainfall"
  }
];

// App states
const APP_STATES = {
  VOICE_SELECTION: 'voice_selection',
  TIMER_SETUP: 'timer_setup', 
  ACTIVE_SESSION: 'active_session',
  MEDITATION_SELECTION: 'meditation_selection',
  MEDITATION_ACTIVE: 'meditation_active'
};

function App() {
  // Core state management
  const [currentState, setCurrentState] = useState(APP_STATES.VOICE_SELECTION);
  const [selectedPersona, setSelectedPersona] = useState(0);
  const [sessionMinutes, setSessionMinutes] = useState(15);
  const [currentSession, setCurrentSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [remainingTime, setRemainingTime] = useState(0);
  const [selectedSound, setSelectedSound] = useState(null);
  const [musicTracks, setMusicTracks] = useState([]);
  const [isMeditating, setIsMeditating] = useState(false);
  const [lastCheckIn, setLastCheckIn] = useState(null);

  // Refs and audio
  const audioRef = useRef(null);
  const wsRef = useRef(null);
  const timerRef = useRef(null);

  // Speech recognition
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition
  } = useSpeechRecognition();

  // Voice persona navigation
  const navigatePersona = (direction) => {
    if (direction === 'left') {
      setSelectedPersona(prev => prev === 0 ? VOICE_PERSONAS.length - 1 : prev - 1);
    } else {
      setSelectedPersona(prev => (prev + 1) % VOICE_PERSONAS.length);
    }
    
    // Trigger voice introduction
    speakIntroduction();
  };

  // Voice introduction when persona changes
  const speakIntroduction = async () => {
    const persona = VOICE_PERSONAS[selectedPersona];
    const message = `Hi, I'm ${persona.name}, your ${persona.title}. We can start our conversation if you think I can help you out!`;
    
    try {
      const response = await axios.post(`${BACKEND_URL}/api/generate-speech`, {
        message,
        voice_persona: persona.id
      });
      
      if (response.data.audio_data) {
        playAudioFromBase64(response.data.audio_data);
      }
    } catch (error) {
      console.error('Failed to generate speech:', error);
    }
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

  // Timer controls
  const adjustTimer = (change) => {
    setSessionMinutes(prev => {
      const newValue = prev + change;
      return Math.max(5, Math.min(60, newValue));
    });
  };

  // Start therapy session
  const startSession = async () => {
    try {
      const persona = VOICE_PERSONAS[selectedPersona];
      
      const response = await axios.post(`${BACKEND_URL}/api/session`, {
        voice_persona: persona.id,
        session_type: 'therapy_conversation',
        duration_minutes: sessionMinutes
      });
      
      setCurrentSession(response.data);
      setRemainingTime(sessionMinutes * 60); // Convert to seconds
      setCurrentState(APP_STATES.ACTIVE_SESSION);
      
      // Start timer
      startTimer();
      
      // Initialize WebSocket
      initializeWebSocket(response.data.id);
      
      // Start with greeting
      const greeting = "Hey, how's your day! Do you want to share anything with me?";
      setMessages([{ type: 'therapist', content: greeting, timestamp: new Date() }]);
      
      // Generate and play greeting
      setTimeout(() => {
        generateTherapistResponse(greeting);
      }, 1000);
      
      // Start speech recognition
      SpeechRecognition.startListening({ continuous: true });
      
    } catch (error) {
      console.error('Failed to start session:', error);
    }
  };

  // Initialize WebSocket connection
  const initializeWebSocket = (sessionId) => {
    const wsUrl = `${BACKEND_URL.replace('https:', 'wss:').replace('http:', 'ws:')}/api/meditation-session/${sessionId}`;
    wsRef.current = new WebSocket(wsUrl);
    
    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
    };
    
    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    };
  };

  // Handle WebSocket messages
  const handleWebSocketMessage = (data) => {
    if (data.audio) {
      playAudioFromBase64(data.audio);
    }
    
    if (data.type === 'meditation_suggestion') {
      setCurrentState(APP_STATES.MEDITATION_SELECTION);
    }
  };

  // Generate therapist response using LLM
  const generateTherapistResponse = async (userInput) => {
    try {
      const therapeuticPrompt = `You are an experienced, compassionate therapist specializing in mental health support. 

Guidelines:
1. Always respond with empathy and validation
2. Ask open-ended questions to encourage deeper sharing
3. If user seems stressed/anxious, offer meditation or breathing exercises
4. Keep responses conversational and supportive (under 100 words)
5. If you sense the user needs calming, suggest: "Would you like to try some meditation? I can play some soothing sounds."
6. Focus on emotional well-being and mental health improvement
7. Be a good listener and reflect what you hear

Context: This is a ${sessionMinutes}-minute therapy session. User said: "${userInput}"

Respond as their therapist:`;
      
      const response = await axios.post(`${BACKEND_URL}/api/generate-speech`, {
        message: therapeuticPrompt,
        voice_persona: VOICE_PERSONAS[selectedPersona].id
      });
      
      // For now, we'll use a simulated response since LLM integration needs refinement
      const responses = [
        "I hear you. That sounds like it's been weighing on you. Can you tell me more about how that makes you feel?",
        "Thank you for sharing that with me. It takes courage to open up. What's been your biggest challenge lately?",
        "I can sense there's a lot going on for you right now. Sometimes it helps to just breathe and be present. Would you like to try some meditation?",
        "Your feelings are completely valid. How has this been affecting your daily life?",
        "I appreciate your honesty. It sounds like you're dealing with a lot. What usually helps you feel more centered?"
      ];
      
      const therapeuticResponse = responses[Math.floor(Math.random() * responses.length)];
      
      setMessages(prev => [...prev, { 
        type: 'therapist', 
        content: therapeuticResponse, 
        timestamp: new Date() 
      }]);
      
      // Check if we should suggest meditation
      if (therapeuticResponse.includes('meditation')) {
        setTimeout(() => {
          setCurrentState(APP_STATES.MEDITATION_SELECTION);
        }, 3000);
      }
      
    } catch (error) {
      console.error('Failed to generate response:', error);
    }
  };

  // Start meditation with selected sound
  const startMeditation = async (sound) => {
    setSelectedSound(sound);
    setIsMeditating(true);
    setCurrentState(APP_STATES.MEDITATION_ACTIVE);
    
    try {
      // Load music tracks for the selected category
      const response = await axios.get(`${BACKEND_URL}/api/music/${sound.category}`);
      setMusicTracks(response.data.tracks);
      
      setMessages(prev => [...prev, { 
        type: 'therapist', 
        content: `Perfect choice. Let's begin with ${sound.name}. Just focus on your breathing and let the sounds wash over you.`, 
        timestamp: new Date() 
      }]);
      
      // Set check-in timer for 5 minutes
      setLastCheckIn(Date.now());
      
    } catch (error) {
      console.error('Failed to load meditation music:', error);
    }
  };

  // Timer functionality
  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setRemainingTime(prev => {
        if (prev <= 1) {
          endSession();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Check-in during meditation (every 5 minutes)
  useEffect(() => {
    if (isMeditating && lastCheckIn) {
      const checkInTimer = setInterval(() => {
        const now = Date.now();
        if (now - lastCheckIn >= 5 * 60 * 1000) { // 5 minutes
          setMessages(prev => [...prev, { 
            type: 'therapist', 
            content: 'How are you feeling now? Are you finding some peace in this moment?', 
            timestamp: new Date() 
          }]);
          setLastCheckIn(now);
        }
      }, 1000);
      
      return () => clearInterval(checkInTimer);
    }
  }, [isMeditating, lastCheckIn]);

  // Handle user speech input
  useEffect(() => {
    if (transcript && currentState === APP_STATES.ACTIVE_SESSION) {
      setMessages(prev => [...prev, { 
        type: 'user', 
        content: transcript, 
        timestamp: new Date() 
      }]);
      
      // Generate therapist response
      generateTherapistResponse(transcript);
      resetTranscript();
    }
  }, [transcript, currentState, resetTranscript]);

  // End session
  const endSession = () => {
    // Clear timers
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    // Stop speech recognition
    SpeechRecognition.stopListening();
    
    // Final message
    setMessages(prev => [...prev, { 
      type: 'therapist', 
      content: 'Thank you for sharing this time with me. Remember, you have the strength within you. Take care, and I hope you feel more centered now.', 
      timestamp: new Date() 
    }]);
    
    // Reset to initial state after a delay
    setTimeout(() => {
      setCurrentState(APP_STATES.VOICE_SELECTION);
      setSelectedPersona(0);
      setSessionMinutes(15);
      setCurrentSession(null);
      setMessages([]);
      setRemainingTime(0);
      setSelectedSound(null);
      setIsMeditating(false);
      setLastCheckIn(null);
    }, 3000);
  };

  // Format time display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!browserSupportsSpeechRecognition) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center p-8">
          <h1 className="text-2xl font-semibold text-gray-800 mb-4">Browser Support Required</h1>
          <p className="text-gray-600">Please use Chrome or Edge for voice features.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 relative overflow-hidden">
      {/* Session End Button - Top Right (Only during active session) */}
      {(currentState === APP_STATES.ACTIVE_SESSION || 
        currentState === APP_STATES.MEDITATION_SELECTION || 
        currentState === APP_STATES.MEDITATION_ACTIVE) && (
        <motion.button
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={endSession}
          className="fixed top-6 right-6 z-50 bg-white shadow-lg rounded-full p-3 hover:shadow-xl transition-all duration-300"
        >
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </motion.button>
      )}

      {/* Timer Display - Top Center (During active session) */}
      {(currentState === APP_STATES.ACTIVE_SESSION || 
        currentState === APP_STATES.MEDITATION_SELECTION || 
        currentState === APP_STATES.MEDITATION_ACTIVE) && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-6 left-1/2 transform -translate-x-1/2 z-40"
        >
          <div className="bg-white shadow-lg rounded-full px-6 py-3">
            <div className="text-2xl font-bold text-gray-800">
              {formatTime(remainingTime)}
            </div>
          </div>
        </motion.div>
      )}

      <div className="min-h-screen flex items-center justify-center p-8">
        <AnimatePresence mode="wait">
          {/* Voice Selection State */}
          {currentState === APP_STATES.VOICE_SELECTION && (
            <motion.div
              key="voice-selection"
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -50 }}
              transition={{ duration: 0.6 }}
              className="text-center"
            >
              <motion.h1 
                className="text-4xl font-bold text-gray-800 mb-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                Choose Your Therapist
              </motion.h1>
              
              <motion.p 
                className="text-gray-600 mb-12"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                Select a voice that feels right for your session
              </motion.p>

              {/* Voice Persona Carousel */}
              <div className="flex items-center justify-center space-x-12 mb-12">
                {/* Left Arrow */}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => navigatePersona('left')}
                  className="flex-shrink-0 p-4 rounded-full bg-white shadow-lg hover:shadow-xl transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </motion.button>

                {/* Current Persona */}
                <motion.div
                  key={selectedPersona}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="flex-shrink-0 text-center min-w-0"
                >
                  <motion.div
                    className={`w-40 h-40 rounded-full bg-gradient-to-r ${VOICE_PERSONAS[selectedPersona].color} flex items-center justify-center text-5xl mb-6 shadow-2xl cursor-pointer mx-auto relative overflow-hidden`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setCurrentState(APP_STATES.TIMER_SETUP)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <span 
                      className="select-none pointer-events-none"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: '1',
                        fontSize: '3.5rem'
                      }}
                    >
                      {VOICE_PERSONAS[selectedPersona].avatar}
                    </span>
                  </motion.div>
                  
                  <div className="max-w-xs mx-auto">
                    <h3 className="text-2xl font-bold text-gray-800 mb-2 truncate">
                      {VOICE_PERSONAS[selectedPersona].name}
                    </h3>
                    <p className="text-lg text-gray-600 mb-2 truncate">
                      {VOICE_PERSONAS[selectedPersona].title}
                    </p>
                    <p className="text-sm text-gray-500 leading-relaxed">
                      {VOICE_PERSONAS[selectedPersona].description}
                    </p>
                  </div>
                </motion.div>

                {/* Right Arrow */}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => navigatePersona('right')}
                  className="flex-shrink-0 p-4 rounded-full bg-white shadow-lg hover:shadow-xl transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </motion.button>
              </div>

              <motion.p 
                className="text-sm text-gray-500"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                Click on the therapist to continue
              </motion.p>
            </motion.div>
          )}

          {/* Timer Setup State */}
          {currentState === APP_STATES.TIMER_SETUP && (
            <motion.div
              key="timer-setup"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.6 }}
              className="text-center"
            >
              <motion.h2 
                className="text-3xl font-bold text-gray-800 mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                Set Session Duration
              </motion.h2>

              <div className="flex items-center justify-center space-x-8 mb-12">
                {/* Minus Button */}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => adjustTimer(-5)}
                  className="w-16 h-16 rounded-full bg-white shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center"
                >
                  <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" />
                  </svg>
                </motion.button>

                {/* Timer Display */}
                <motion.div
                  className="bg-white rounded-2xl shadow-2xl p-8"
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <div className="text-6xl font-bold text-gray-800 mb-2">
                    {sessionMinutes}
                  </div>
                  <div className="text-lg text-gray-600">
                    minutes
                  </div>
                </motion.div>

                {/* Plus Button */}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => adjustTimer(5)}
                  className="w-16 h-16 rounded-full bg-white shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center"
                >
                  <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                  </svg>
                </motion.button>
              </div>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={startSession}
                className={`px-12 py-4 rounded-full bg-gradient-to-r ${VOICE_PERSONAS[selectedPersona].color} text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                Start Session
              </motion.button>
            </motion.div>
          )}

          {/* Active Session State */}
          {currentState === APP_STATES.ACTIVE_SESSION && (
            <motion.div
              key="active-session"
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -50 }}
              transition={{ duration: 0.6 }}
              className="w-full max-w-4xl mx-auto"
            >
              {/* Therapist Avatar - Center */}
              <div className="text-center mb-12">
                <motion.div
                  className={`w-24 h-24 rounded-full bg-gradient-to-r ${VOICE_PERSONAS[selectedPersona].color} flex items-center justify-center text-3xl mx-auto shadow-2xl`}
                  animate={{
                    scale: listening ? [1, 1.1, 1] : 1,
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: listening ? Infinity : 0
                  }}
                >
                  {VOICE_PERSONAS[selectedPersona].avatar}
                </motion.div>
                
                <h3 className="text-xl font-semibold text-gray-800 mt-4">
                  {VOICE_PERSONAS[selectedPersona].name}
                </h3>
                
                <div className="mt-4">
                  {listening ? (
                    <div className="flex justify-center space-x-1">
                      {[...Array(4)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-1 bg-blue-500 rounded-full"
                          animate={{
                            height: [8, 20, 8],
                          }}
                          transition={{
                            duration: 0.8,
                            repeat: Infinity,
                            delay: i * 0.2,
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Listening...</p>
                  )}
                </div>
              </div>

              {/* Conversation Messages */}
              <div className="bg-white rounded-2xl shadow-lg p-6 max-h-96 overflow-y-auto">
                <div className="space-y-4">
                  {messages.map((message, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${
                        message.type === 'user' 
                          ? 'bg-blue-500 text-white' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        <p className="text-sm">{message.content}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="text-center mt-6">
                <p className="text-sm text-gray-500">
                  {listening ? "I'm listening..." : "Speak freely about what's on your mind"}
                </p>
              </div>
            </motion.div>
          )}

          {/* Meditation Selection State */}
          {currentState === APP_STATES.MEDITATION_SELECTION && (
            <motion.div
              key="meditation-selection"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.6 }}
              className="text-center"
            >
              <motion.h2 
                className="text-3xl font-bold text-gray-800 mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                Choose Meditation Sounds
              </motion.h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                {MEDITATION_SOUNDS.map((sound, index) => (
                  <motion.div
                    key={sound.id}
                    initial={{ opacity: 0, y: 50 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.2 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => startMeditation(sound)}
                    className="bg-white rounded-2xl shadow-lg p-8 cursor-pointer hover:shadow-xl transition-all duration-300"
                  >
                    <div className="text-6xl mb-4">{sound.icon}</div>
                    <h3 className="text-xl font-semibold text-gray-800 mb-2">
                      {sound.name}
                    </h3>
                    <p className="text-gray-600 text-sm">
                      {sound.description}
                    </p>
                  </motion.div>
                ))}
              </div>

              <motion.button
                whileHover={{ scale: 1.05 }}
                onClick={() => setCurrentState(APP_STATES.ACTIVE_SESSION)}
                className="text-gray-500 hover:text-gray-700 transition-colors duration-300"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
              >
                Continue without meditation
              </motion.button>
            </motion.div>
          )}

          {/* Meditation Active State */}
          {currentState === APP_STATES.MEDITATION_ACTIVE && (
            <motion.div
              key="meditation-active"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1 }}
              className="text-center"
            >
              <motion.div
                className="w-64 h-64 rounded-full bg-gradient-to-r from-blue-400 to-purple-500 flex items-center justify-center text-8xl mx-auto shadow-2xl mb-8"
                animate={{
                  scale: [1, 1.1, 1],
                  rotate: [0, 5, -5, 0]
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              >
                {selectedSound?.icon}
              </motion.div>

              <h2 className="text-2xl font-semibold text-gray-800 mb-4">
                {selectedSound?.name}
              </h2>

              <p className="text-gray-600 mb-8">
                Focus on your breathing and let the sounds guide you to peace
              </p>

              {/* Music player would go here */}
              {musicTracks.length > 0 && musicTracks[0].preview_url && (
                <audio
                  src={musicTracks[0].preview_url}
                  autoPlay
                  loop
                  className="hidden"
                />
              )}

              <motion.button
                whileHover={{ scale: 1.05 }}
                onClick={() => setCurrentState(APP_STATES.ACTIVE_SESSION)}
                className="text-gray-500 hover:text-gray-700 transition-colors duration-300"
              >
                Return to conversation
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Audio element for playing responses */}
      <audio ref={audioRef} style={{ display: 'none' }} />
    </div>
  );
}

export default App;