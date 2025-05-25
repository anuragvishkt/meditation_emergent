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
  // State for speech and conversation management
  const [currentState, setCurrentState] = useState(APP_STATES.VOICE_SELECTION);
  const [selectedPersona, setSelectedPersona] = useState(0);
  const [sessionMinutes, setSessionMinutes] = useState(15);
  const [currentSession, setCurrentSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [remainingTime, setRemainingTime] = useState(0);
  const [selectedSound, setSelectedSound] = useState(null);
  const [musicTracks, setMusicTracks] = useState([]);
  const [isMeditating, setIsMeditating] = useState(false);
  const [lastCheckIn, setLastCheckIn] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [speechBuffer, setSpeechBuffer] = useState('');
  const [conversationHeight, setConversationHeight] = useState('auto');

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
      // Analyze user input for stress/anxiety keywords to suggest meditation
      const stressKeywords = ['stress', 'anxious', 'worried', 'overwhelmed', 'tired', 'exhausted', 'tension', 'pressure', 'nervous', 'restless', 'cannot sleep', 'overthinking'];
      const suggestMeditation = stressKeywords.some(keyword => userInput.toLowerCase().includes(keyword));
      
      // Simulate therapeutic responses with meditation suggestions
      const therapeuticResponses = [
        "I hear you, and I want you to know that your feelings are completely valid. Can you tell me more about what's been weighing on your mind?",
        "Thank you for sharing that with me. It takes courage to open up. What's been your biggest source of support during this time?",
        "Your feelings are completely understandable. Sometimes when we're dealing with a lot, it can help to take a step back and breathe. How has this been affecting your daily routine?",
        "I appreciate your honesty. It sounds like you're carrying a lot right now. What usually helps you feel more centered when things get overwhelming?",
        "That sounds really challenging. You're doing the best you can with what you're facing. Have you noticed any patterns in when these feelings tend to be strongest?"
      ];
      
      const meditationSuggestions = [
        "I can sense there's a lot going on for you right now. Sometimes it helps to just pause and be present with ourselves. Would you like to try some meditation together?",
        "It sounds like your mind has been quite busy lately. Meditation can be a wonderful way to find some peace. Shall we explore some calming sounds together?",
        "You've been through a lot. Sometimes our minds need a gentle rest. Would you be interested in some guided meditation to help you find a moment of calm?",
        "I hear the weight you're carrying. Meditation can be like giving your mind a warm, safe space to rest. Would you like to try some soothing sounds?"
      ];
      
      let response;
      if (suggestMeditation || Math.random() < 0.3) { // 30% chance or if stress keywords detected
        response = meditationSuggestions[Math.floor(Math.random() * meditationSuggestions.length)];
        
        // Trigger meditation selection after response
        setTimeout(() => {
          setCurrentState(APP_STATES.MEDITATION_SELECTION);
        }, 4000);
      } else {
        response = therapeuticResponses[Math.floor(Math.random() * therapeuticResponses.length)];
      }
      
      setMessages(prev => [...prev, { 
        type: 'therapist', 
        content: response, 
        timestamp: new Date() 
      }]);
      
      // Generate speech if possible
      try {
        const speechResponse = await axios.post(`${BACKEND_URL}/api/generate-speech`, {
          message: response,
          voice_persona: VOICE_PERSONAS[selectedPersona].id
        });
        
        if (speechResponse.data.audio_data) {
          playAudioFromBase64(speechResponse.data.audio_data);
        }
      } catch (speechError) {
        console.log('Speech synthesis not available, continuing with text only');
      }
      
    } catch (error) {
      console.error('Failed to generate response:', error);
      const fallbackResponse = "I'm here to listen and support you. Sometimes just having someone who understands can make a difference. What would feel most helpful for you right now?";
      
      setMessages(prev => [...prev, { 
        type: 'therapist', 
        content: fallbackResponse, 
        timestamp: new Date() 
      }]);
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

      {/* Timer Display - Top Left (During active session) */}
      {(currentState === APP_STATES.ACTIVE_SESSION || 
        currentState === APP_STATES.MEDITATION_SELECTION || 
        currentState === APP_STATES.MEDITATION_ACTIVE) && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="fixed top-6 left-6 z-40"
        >
          <div className="bg-white shadow-lg rounded-full px-6 py-3 border border-gray-100">
            <div className="text-xl font-bold text-gray-800 tabular-nums">
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

              <div className="flex items-center justify-center space-x-12 mb-12">
                {/* Minus Button */}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => adjustTimer(-5)}
                  className="flex-shrink-0 w-20 h-20 rounded-full bg-white shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" />
                  </svg>
                </motion.button>

                {/* Timer Display */}
                <motion.div
                  className="flex-shrink-0 bg-white rounded-3xl shadow-2xl p-12 border border-gray-100"
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <div className="text-center">
                    <div className="text-7xl font-bold text-gray-800 mb-3 tabular-nums">
                      {sessionMinutes}
                    </div>
                    <div className="text-xl text-gray-600 font-medium">
                      minutes
                    </div>
                  </div>
                </motion.div>

                {/* Plus Button */}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => adjustTimer(5)}
                  className="flex-shrink-0 w-20 h-20 rounded-full bg-white shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              <div className="flex flex-col items-center justify-center mb-12">
                <motion.div
                  className={`w-28 h-28 rounded-full bg-gradient-to-r ${VOICE_PERSONAS[selectedPersona].color} flex items-center justify-center text-4xl shadow-2xl relative overflow-hidden`}
                  animate={{
                    scale: listening ? [1, 1.1, 1] : 1,
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: listening ? Infinity : 0
                  }}
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
                      fontSize: '2.5rem'
                    }}
                  >
                    {VOICE_PERSONAS[selectedPersona].avatar}
                  </span>
                </motion.div>
                
                <h3 className="text-xl font-semibold text-gray-800 mt-6 mb-4 text-center">
                  {VOICE_PERSONAS[selectedPersona].name}
                </h3>
                
                <div className="flex flex-col items-center justify-center">
                  {listening ? (
                    <div className="flex justify-center items-center space-x-1 mb-2">
                      {[...Array(4)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-1 bg-blue-500 rounded-full"
                          animate={{
                            height: [8, 24, 8],
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
                    <div className="h-6 flex items-center justify-center mb-2">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                    </div>
                  )}
                  <p className="text-sm text-gray-500 text-center">
                    {listening ? "I'm listening..." : "Speak freely about what's on your mind"}
                  </p>
                </div>
              </div>

              {/* Conversation Messages */}
              <div className="bg-white rounded-2xl shadow-lg p-6 max-h-96 overflow-y-auto custom-scrollbar">
                <div className="space-y-4">
                  {messages.map((message, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl ${
                        message.type === 'user' 
                          ? 'bg-blue-500 text-white' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        <p className="text-sm leading-relaxed">{message.content}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Meditation Access Button */}
              <div className="flex justify-center mt-6">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setCurrentState(APP_STATES.MEDITATION_SELECTION)}
                  className="flex items-center space-x-3 px-6 py-3 bg-gradient-to-r from-purple-400 to-blue-500 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-300"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  <span className="text-lg">🧘‍♀️</span>
                  <span className="font-medium">Start Meditation</span>
                </motion.button>
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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto mb-8">
                {MEDITATION_SOUNDS.map((sound, index) => (
                  <motion.div
                    key={sound.id}
                    initial={{ opacity: 0, y: 50 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.2 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => startMeditation(sound)}
                    className="bg-white rounded-3xl shadow-lg p-8 cursor-pointer hover:shadow-xl transition-all duration-300 text-center border border-gray-100"
                  >
                    <div className="flex items-center justify-center mb-6">
                      <span 
                        className="text-7xl select-none"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          lineHeight: '1'
                        }}
                      >
                        {sound.icon}
                      </span>
                    </div>
                    <h3 className="text-xl font-semibold text-gray-800 mb-3">
                      {sound.name}
                    </h3>
                    <p className="text-gray-600 text-sm leading-relaxed">
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
                className="w-80 h-80 rounded-full bg-gradient-to-r from-blue-400 to-purple-500 flex items-center justify-center shadow-2xl mb-8 mx-auto relative overflow-hidden"
                animate={{
                  scale: [1, 1.1, 1],
                  rotate: [0, 5, -5, 0]
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <span 
                  className="text-9xl select-none"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: '1'
                  }}
                >
                  {selectedSound?.icon}
                </span>
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