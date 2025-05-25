from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import base64
import uuid
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from groq import Groq
import spotipy
from spotipy.oauth2 import SpotifyOAuth, SpotifyClientCredentials
import aiofiles

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Initialize Groq client
groq_client = Groq(api_key=os.environ['GROQ_API_KEY'])

# Spotify configuration
SPOTIFY_CLIENT_ID = os.environ['SPOTIFY_CLIENT_ID']
SPOTIFY_CLIENT_SECRET = os.environ['SPOTIFY_CLIENT_SECRET']
SPOTIFY_REDIRECT_URI = os.environ['SPOTIFY_REDIRECT_URI']

# Create the main app
app = FastAPI(title="Meditation Voice Assistant API")
api_router = APIRouter(prefix="/api")

# Security
security = HTTPBearer()

# Models
class MeditationSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    voice_persona: str
    session_type: str
    duration_minutes: int = 60
    ambient_category: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = "active"  # active, paused, completed
    check_ins: List[datetime] = Field(default_factory=list)

class VoiceMessage(BaseModel):
    message: str
    voice_persona: str = "calm_female"
    session_id: Optional[str] = None

class MusicRequest(BaseModel):
    category: str
    session_id: str

class MeditationSessionCreate(BaseModel):
    voice_persona: str = "calm_female"
    session_type: str = "guided_breathing"
    duration_minutes: int = 60
    ambient_category: Optional[str] = None

# Voice personas configuration with updated voice IDs
VOICE_PERSONAS = {
    "calm_female": {
        "name": "Serene Sarah",
        "voice_id": "Aaliyah-PlayAI",
        "description": "Calm and nurturing female voice"
    },
    "wise_male": {
        "name": "Mindful Marcus", 
        "voice_id": "Atlas-PlayAI",
        "description": "Deep and reassuring male voice"
    },
    "gentle_guide": {
        "name": "Peaceful Priya",
        "voice_id": "Indigo-PlayAI", 
        "description": "Gentle and guiding voice"
    },
    "nature_spirit": {
        "name": "Forest Finn",
        "voice_id": "Cheyenne-PlayAI",
        "description": "Natural and earthy voice"
    },
    "zen_master": {
        "name": "Tranquil Tara",
        "voice_id": "Mason-PlayAI",
        "description": "Wise and centered voice"
    }
}

# Meditation categories for music
MEDITATION_CATEGORIES = {
    "rainfall": {
        "name": "Rainfall/Thunder",
        "keywords": ["rain", "thunder", "storm", "rainfall meditation"],
        "spotify_queries": ["rain sounds", "thunder meditation", "rainfall ambient"]
    },
    "ocean": {
        "name": "Ocean Waves", 
        "keywords": ["ocean", "waves", "sea", "beach meditation"],
        "spotify_queries": ["ocean waves", "sea sounds", "beach meditation"]
    },
    "forest": {
        "name": "Forest/Nature Sounds",
        "keywords": ["forest", "nature", "birds", "woodland meditation"], 
        "spotify_queries": ["forest sounds", "nature meditation", "bird songs ambient"]
    },
    "whitenoise": {
        "name": "White Noise/Pink Noise",
        "keywords": ["white noise", "pink noise", "ambient", "focus sounds"],
        "spotify_queries": ["white noise", "pink noise meditation", "ambient focus"]
    },
    "tibetan": {
        "name": "Tibetan Bowls/Meditation Bells",
        "keywords": ["tibetan", "singing bowls", "bells", "chakra meditation"],
        "spotify_queries": ["tibetan bowls", "singing bowls meditation", "meditation bells"]
    }
}

# WebSocket connection manager with enhanced speech handling
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.session_data: Dict[str, Dict] = {}
        self.speech_states: Dict[str, Dict] = {}  # Track speech states per session

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        self.session_data[session_id] = {
            "start_time": datetime.utcnow(),
            "last_checkin": datetime.utcnow(),
            "interaction_count": 0
        }
        self.speech_states[session_id] = {
            "is_speaking": False,
            "is_listening": False,
            "last_speech_time": None,
            "speech_buffer": "",
            "pause_timer": None,
            "current_audio_task": None
        }

    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]
        if session_id in self.session_data:
            del self.session_data[session_id]
        if session_id in self.speech_states:
            # Cancel any ongoing audio if user disconnects
            speech_state = self.speech_states[session_id]
            if speech_state["current_audio_task"]:
                speech_state["current_audio_task"].cancel()
            del self.speech_states[session_id]

    async def send_audio(self, session_id: str, audio_data: bytes):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_bytes(audio_data)

    async def send_text(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_text(json.dumps(message))

    def start_speaking(self, session_id: str):
        """Mark session as speaking (AI is responding)"""
        if session_id in self.speech_states:
            self.speech_states[session_id]["is_speaking"] = True
            self.speech_states[session_id]["is_listening"] = False

    def stop_speaking(self, session_id: str):
        """Mark session as stopped speaking"""
        if session_id in self.speech_states:
            self.speech_states[session_id]["is_speaking"] = False
            # Cancel current audio task if any
            if self.speech_states[session_id]["current_audio_task"]:
                self.speech_states[session_id]["current_audio_task"].cancel()
                self.speech_states[session_id]["current_audio_task"] = None

    def start_listening(self, session_id: str):
        """Mark session as listening for user input"""
        if session_id in self.speech_states:
            self.speech_states[session_id]["is_listening"] = True
            self.speech_states[session_id]["is_speaking"] = False

    def is_user_speaking(self, session_id: str) -> bool:
        """Check if user is currently speaking"""
        if session_id in self.speech_states:
            return self.speech_states[session_id]["is_listening"]
        return False

    def should_interrupt_speech(self, session_id: str) -> bool:
        """Check if AI speech should be interrupted"""
        if session_id in self.speech_states:
            speech_state = self.speech_states[session_id]
            return speech_state["is_speaking"] and speech_state["is_listening"]
        return False

manager = ConnectionManager()

# Helper functions
async def generate_speech(text: str, voice_persona: str = "calm_female") -> bytes:
    """Generate speech using available TTS services"""
    try:
        voice_config = VOICE_PERSONAS.get(voice_persona, VOICE_PERSONAS["calm_female"])
        
        # Try Groq PlayAI TTS first
        try:
            response = groq_client.audio.speech.create(
                model="playai-tts",
                voice=voice_config["voice_id"],
                input=text
            )
            return response.content
        except Exception as groq_error:
            logging.warning(f"Groq TTS failed: {str(groq_error)}")
            
            # Try OpenAI TTS as fallback (if available)
            try:
                # Check if OpenAI API key is available in environment
                openai_key = os.environ.get('OPENAI_API_KEY')
                if openai_key:
                    import openai
                    openai_client = openai.OpenAI(api_key=openai_key)
                    
                    # Map Groq voices to OpenAI voices
                    openai_voice_map = {
                        "Celeste-PlayAI": "nova",
                        "Calum-PlayAI": "onyx", 
                        "Cheyenne-PlayAI": "shimmer",
                        "Basil-PlayAI": "echo",
                        "Deedee-PlayAI": "alloy"
                    }
                    
                    openai_voice = openai_voice_map.get(voice_config["voice_id"], "nova")
                    
                    response = openai_client.audio.speech.create(
                        model="tts-1",
                        voice=openai_voice,
                        input=text
                    )
                    return response.content
                else:
                    logging.info("OpenAI API key not available, skipping OpenAI TTS")
                    
            except Exception as openai_error:
                logging.warning(f"OpenAI TTS fallback failed: {str(openai_error)}")
        
        # If all TTS services fail, return empty bytes (app will continue without audio)
        logging.info("TTS services unavailable, continuing without audio")
        return b""
        
    except Exception as e:
        logging.error(f"TTS Error: {str(e)}")
        return b""

async def transcribe_audio(audio_data: bytes) -> str:
    """Transcribe audio using Groq Whisper"""
    try:
        # Save audio to temporary file
        temp_file = f"/tmp/audio_{uuid.uuid4()}.wav"
        async with aiofiles.open(temp_file, 'wb') as f:
            await f.write(audio_data)
        
        # Transcribe using Groq Whisper
        with open(temp_file, "rb") as audio_file:
            transcription = groq_client.audio.transcriptions.create(
                file=audio_file,
                model="whisper-large-v3"
            )
        
        # Clean up temp file
        os.remove(temp_file)
        return transcription.text
    except Exception as e:
        logging.error(f"STT Error: {str(e)}")
        return ""

async def generate_meditation_response(user_input: str, session_context: dict) -> str:
    """Generate meditation guidance using Groq LLM"""
    try:
        system_prompt = """You are a wise and compassionate meditation guide. You specialize in:
        - Guided breathing exercises
        - Mindfulness meditation
        - Stress relief and relaxation
        - Gentle check-ins during sessions
        
        Guidelines:
        1. Keep responses under 50 words for voice synthesis
        2. Use calming, present-moment language
        3. Provide gentle guidance and encouragement
        4. If user seems distressed, offer grounding techniques
        5. For breathing exercises, give clear "breathe in" and "breathe out" instructions
        """
        
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Session context: {session_context}. User said: {user_input}"}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.3,
            max_tokens=100
        )
        
        return chat_completion.choices[0].message.content
    except Exception as e:
        logging.error(f"LLM Error: {str(e)}")
        return "Let's take a moment to breathe together. Inhale deeply... and exhale slowly."

async def handle_user_speech_with_pause(session_id: str, transcript: str, speech_context: dict):
    """Handle user speech with pause detection to reduce API calls"""
    if session_id not in manager.speech_states:
        return
    
    speech_state = manager.speech_states[session_id]
    current_time = datetime.utcnow()
    
    # Update speech buffer and last speech time
    speech_state["speech_buffer"] += " " + transcript.strip()
    speech_state["last_speech_time"] = current_time
    
    # Cancel existing pause timer if any
    if speech_state["pause_timer"]:
        speech_state["pause_timer"].cancel()
    
    # Set new pause timer (2-3 seconds)
    async def process_after_pause():
        try:
            await asyncio.sleep(2.5)  # Wait 2.5 seconds for pause
            
            # Check if user is still speaking or if speech was interrupted
            if (speech_state["last_speech_time"] and 
                (datetime.utcnow() - speech_state["last_speech_time"]).total_seconds() >= 2.5):
                
                # Process the accumulated speech
                full_transcript = speech_state["speech_buffer"].strip()
                if full_transcript:
                    # Clear buffer
                    speech_state["speech_buffer"] = ""
                    
                    # Generate response
                    response_text = await generate_meditation_response(full_transcript, speech_context)
                    
                    # Check if user started speaking again (interrupt prevention)
                    if not manager.is_user_speaking(session_id):
                        # Mark as speaking and generate audio
                        manager.start_speaking(session_id)
                        
                        # Create audio generation task
                        audio_task = asyncio.create_task(
                            generate_and_send_speech_response(session_id, response_text, full_transcript)
                        )
                        speech_state["current_audio_task"] = audio_task
                        
                        # Await audio task
                        try:
                            await audio_task
                        except asyncio.CancelledError:
                            logging.info(f"Audio generation cancelled for session {session_id}")
                        finally:
                            manager.stop_speaking(session_id)
                            
        except asyncio.CancelledError:
            logging.info(f"Pause timer cancelled for session {session_id}")
    
    # Create and store the pause timer task
    speech_state["pause_timer"] = asyncio.create_task(process_after_pause())

async def generate_and_send_speech_response(session_id: str, response_text: str, user_input: str):
    """Generate speech response and send to client"""
    try:
        # Generate speech response
        response_audio = await generate_speech(response_text)
        
        # Send response to client
        await manager.send_text(session_id, {
            "type": "conversation",
            "user_input": user_input,
            "response": response_text,
            "audio": base64.b64encode(response_audio).decode('utf-8') if response_audio else "",
            "speaking": True
        })
        
        # Update session data
        if session_id in manager.session_data:
            manager.session_data[session_id]["interaction_count"] += 1
            manager.session_data[session_id]["last_checkin"] = datetime.utcnow()
            
    except Exception as e:
        logging.error(f"Error generating speech response: {str(e)}")
        # Send text-only response if speech fails
        await manager.send_text(session_id, {
            "type": "conversation",
            "user_input": user_input,
            "response": response_text,
            "audio": "",
            "speaking": False
        })

def get_spotify_client():
    """Get Spotify client for searching tracks"""
    return spotipy.Spotify(client_credentials_manager=SpotifyClientCredentials(
        client_id=SPOTIFY_CLIENT_ID,
        client_secret=SPOTIFY_CLIENT_SECRET
    ))

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Meditation Voice Assistant API", "status": "active"}

@api_router.get("/voice-personas")
async def get_voice_personas():
    """Get available voice personas"""
    return {"personas": VOICE_PERSONAS}

@api_router.get("/meditation-categories")
async def get_meditation_categories():
    """Get available meditation music categories"""
    return {"categories": MEDITATION_CATEGORIES}

@api_router.post("/session", response_model=MeditationSession)
async def create_meditation_session(session_data: MeditationSessionCreate):
    """Create a new meditation session"""
    session = MeditationSession(
        user_id="default_user",  # In production, get from auth
        **session_data.dict()
    )
    
    await db.meditation_sessions.insert_one(session.dict())
    return session

@api_router.get("/session/{session_id}", response_model=MeditationSession)
async def get_meditation_session(session_id: str):
    """Get meditation session by ID"""
    session = await db.meditation_sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return MeditationSession(**session)

@api_router.post("/generate-speech")
async def generate_speech_endpoint(voice_message: VoiceMessage):
    """Generate speech from text"""
    try:
        audio_data = await generate_speech(voice_message.message, voice_message.voice_persona)
        
        # Convert to base64 for JSON response
        audio_base64 = base64.b64encode(audio_data).decode('utf-8')
        
        return {
            "audio_data": audio_base64,
            "message": voice_message.message,
            "voice_persona": voice_message.voice_persona
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Speech generation failed: {str(e)}")

@api_router.get("/music/{category}")
async def get_meditation_music(category: str):
    """Get meditation music for a category"""
    if category not in MEDITATION_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")
    
    try:
        spotify = get_spotify_client()
        category_info = MEDITATION_CATEGORIES[category]
        tracks = []
        
        # Search for tracks in this category
        for query in category_info["spotify_queries"][:2]:  # Limit to 2 queries
            results = spotify.search(q=query, type='track', limit=3)
            for track in results['tracks']['items']:
                if len(tracks) < 5:  # Limit to 5 tracks total
                    tracks.append({
                        "id": track['id'],
                        "name": track['name'],
                        "artist": track['artists'][0]['name'],
                        "preview_url": track['preview_url'],
                        "external_url": track['external_urls']['spotify']
                    })
        
        return {
            "category": category,
            "name": category_info["name"],
            "tracks": tracks[:5]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Music search failed: {str(e)}")

# WebSocket endpoint for real-time voice interaction
@api_router.websocket("/meditation-session/{session_id}")
async def websocket_meditation_session(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time meditation session with improved speech handling"""
    await manager.connect(websocket, session_id)
    
    try:
        # Send welcome message
        welcome_message = "Welcome to your meditation session. I'm here to guide you. How are you feeling today?"
        welcome_audio = await generate_speech(welcome_message)
        
        # Mark as speaking for welcome message
        manager.start_speaking(session_id)
        
        await manager.send_text(session_id, {
            "type": "speech",
            "message": welcome_message,
            "audio": base64.b64encode(welcome_audio).decode('utf-8') if welcome_audio else "",
            "speaking": True
        })
        
        # After welcome, start listening
        manager.start_listening(session_id)
        manager.stop_speaking(session_id)
        
        while True:
            # Receive audio or text data
            data = await websocket.receive()
            
            if "bytes" in data:
                # Handle audio input with interruption detection
                audio_data = data["bytes"]
                
                # If AI is currently speaking, interrupt it
                if manager.speech_states.get(session_id, {}).get("is_speaking", False):
                    manager.stop_speaking(session_id)
                    await manager.send_text(session_id, {
                        "type": "speech_interrupted",
                        "message": "Speech interrupted by user"
                    })
                
                # Mark as user speaking/listening
                manager.start_listening(session_id)
                
                # Transcribe audio
                transcript = await transcribe_audio(audio_data)
                
                if transcript.strip():
                    # Send immediate transcript feedback
                    await manager.send_text(session_id, {
                        "type": "transcript",
                        "transcript": transcript,
                        "timestamp": datetime.utcnow().isoformat()
                    })
                    
                    # Handle speech with pause detection
                    session_context = manager.session_data.get(session_id, {})
                    await handle_user_speech_with_pause(session_id, transcript, session_context)
            
            elif "text" in data:
                # Handle text commands and speech start/stop signals
                message = json.loads(data["text"])
                command = message.get("command")
                
                if command == "start_speaking":
                    # User started speaking - interrupt any AI speech
                    if manager.speech_states.get(session_id, {}).get("is_speaking", False):
                        manager.stop_speaking(session_id)
                    manager.start_listening(session_id)
                    
                elif command == "stop_speaking":
                    # User stopped speaking - processing will happen via pause timer
                    pass
                    
                elif command == "check_in":
                    check_in_message = "How are you feeling right now? Are you comfortable and ready to continue?"
                    
                    # Don't interrupt if user is speaking
                    if not manager.is_user_speaking(session_id):
                        manager.start_speaking(session_id)
                        check_in_audio = await generate_speech(check_in_message)
                        
                        await manager.send_text(session_id, {
                            "type": "check_in",
                            "message": check_in_message,
                            "audio": base64.b64encode(check_in_audio).decode('utf-8') if check_in_audio else "",
                            "speaking": True
                        })
                        manager.stop_speaking(session_id)
                
                elif command == "breathing_exercise":
                    breathing_guide = "Let's begin a breathing exercise. Breathe in slowly for 4 counts... hold for 4... and breathe out for 6."
                    
                    if not manager.is_user_speaking(session_id):
                        manager.start_speaking(session_id)
                        breathing_audio = await generate_speech(breathing_guide)
                        
                        await manager.send_text(session_id, {
                            "type": "breathing_exercise", 
                            "message": breathing_guide,
                            "audio": base64.b64encode(breathing_audio).decode('utf-8') if breathing_audio else "",
                            "speaking": True
                        })
                        manager.stop_speaking(session_id)
                
                elif command == "end_session":
                    end_message = "Thank you for this meditation session. You've taken an important step in your wellness journey."
                    
                    # Stop any ongoing speech
                    manager.stop_speaking(session_id)
                    
                    end_audio = await generate_speech(end_message)
                    
                    await manager.send_text(session_id, {
                        "type": "session_end",
                        "message": end_message,
                        "audio": base64.b64encode(end_audio).decode('utf-8') if end_audio else "",
                        "speaking": True
                    })
                    break
    
    except WebSocketDisconnect:
        manager.disconnect(session_id)
    except Exception as e:
        logging.error(f"WebSocket error: {str(e)}")
        manager.disconnect(session_id)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)