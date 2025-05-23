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

# Voice personas configuration
VOICE_PERSONAS = {
    "calm_female": {
        "name": "Serene Sarah",
        "voice_id": "nova",
        "description": "Calm and nurturing female voice"
    },
    "wise_male": {
        "name": "Mindful Marcus", 
        "voice_id": "onyx",
        "description": "Deep and reassuring male voice"
    },
    "gentle_guide": {
        "name": "Peaceful Priya",
        "voice_id": "alloy", 
        "description": "Gentle and guiding voice"
    },
    "nature_spirit": {
        "name": "Forest Finn",
        "voice_id": "echo",
        "description": "Natural and earthy voice"
    },
    "zen_master": {
        "name": "Tranquil Tara",
        "voice_id": "shimmer",
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

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.session_data: Dict[str, Dict] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        self.session_data[session_id] = {
            "start_time": datetime.utcnow(),
            "last_checkin": datetime.utcnow(),
            "interaction_count": 0
        }

    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]
        if session_id in self.session_data:
            del self.session_data[session_id]

    async def send_audio(self, session_id: str, audio_data: bytes):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_bytes(audio_data)

    async def send_text(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_text(json.dumps(message))

manager = ConnectionManager()

# Helper functions
async def generate_speech(text: str, voice_persona: str = "calm_female") -> bytes:
    """Generate speech using Groq TTS"""
    try:
        voice_config = VOICE_PERSONAS.get(voice_persona, VOICE_PERSONAS["calm_female"])
        
        # Using Groq's audio API (simulated - adjust based on actual Groq TTS API)
        response = groq_client.audio.speech.create(
            model="tts-1",
            voice=voice_config["voice_id"],
            input=text
        )
        return response.content
    except Exception as e:
        logging.error(f"TTS Error: {str(e)}")
        # Return empty bytes if TTS fails
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
    """WebSocket endpoint for real-time meditation session"""
    await manager.connect(websocket, session_id)
    
    try:
        # Send welcome message
        welcome_message = "Welcome to your meditation session. I'm here to guide you. How are you feeling today?"
        welcome_audio = await generate_speech(welcome_message)
        
        await manager.send_text(session_id, {
            "type": "speech",
            "message": welcome_message,
            "audio": base64.b64encode(welcome_audio).decode('utf-8')
        })
        
        while True:
            # Receive audio or text data
            data = await websocket.receive()
            
            if "bytes" in data:
                # Handle audio input
                audio_data = data["bytes"]
                transcript = await transcribe_audio(audio_data)
                
                if transcript:
                    # Generate response using LLM
                    session_context = manager.session_data.get(session_id, {})
                    response_text = await generate_meditation_response(transcript, session_context)
                    
                    # Generate speech response
                    response_audio = await generate_speech(response_text)
                    
                    # Send response
                    await manager.send_text(session_id, {
                        "type": "conversation",
                        "user_input": transcript,
                        "response": response_text,
                        "audio": base64.b64encode(response_audio).decode('utf-8')
                    })
                    
                    # Update session data
                    if session_id in manager.session_data:
                        manager.session_data[session_id]["interaction_count"] += 1
                        manager.session_data[session_id]["last_checkin"] = datetime.utcnow()
            
            elif "text" in data:
                # Handle text commands
                message = json.loads(data["text"])
                command = message.get("command")
                
                if command == "check_in":
                    check_in_message = "How are you feeling right now? Are you comfortable and ready to continue?"
                    check_in_audio = await generate_speech(check_in_message)
                    
                    await manager.send_text(session_id, {
                        "type": "check_in",
                        "message": check_in_message,
                        "audio": base64.b64encode(check_in_audio).decode('utf-8')
                    })
                
                elif command == "breathing_exercise":
                    breathing_guide = "Let's begin a breathing exercise. Breathe in slowly for 4 counts... hold for 4... and breathe out for 6."
                    breathing_audio = await generate_speech(breathing_guide)
                    
                    await manager.send_text(session_id, {
                        "type": "breathing_exercise", 
                        "message": breathing_guide,
                        "audio": base64.b64encode(breathing_audio).decode('utf-8')
                    })
                
                elif command == "end_session":
                    end_message = "Thank you for this meditation session. You've taken an important step in your wellness journey."
                    end_audio = await generate_speech(end_message)
                    
                    await manager.send_text(session_id, {
                        "type": "session_end",
                        "message": end_message,
                        "audio": base64.b64encode(end_audio).decode('utf-8')
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
    uvicorn.run(app, host="0.0.0.0", port=8001)