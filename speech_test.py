#!/usr/bin/env python3
"""
Specific test for speech generation issue found in backend testing
"""

import requests
import json

def test_speech_generation_detailed():
    """Test speech generation with detailed error reporting"""
    base_url = "https://734fc207-4da5-4704-b456-da1d73d27080.preview.emergentagent.com"
    
    print("🔍 Testing Speech Generation in Detail...")
    
    # Test all voice personas
    voice_personas = ["calm_female", "wise_male", "gentle_guide", "nature_spirit", "zen_master"]
    
    for persona in voice_personas:
        print(f"\n📢 Testing voice persona: {persona}")
        
        speech_data = {
            "message": "Hello, this is a test message for speech generation.",
            "voice_persona": persona
        }
        
        try:
            response = requests.post(
                f"{base_url}/api/generate-speech",
                json=speech_data,
                timeout=20
            )
            
            print(f"   Status Code: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"   Response Keys: {list(data.keys())}")
                
                if 'audio_data' in data:
                    audio_data = data['audio_data']
                    if audio_data:
                        print(f"   ✅ Audio data present (length: {len(audio_data)} chars)")
                    else:
                        print(f"   ❌ Audio data empty")
                else:
                    print(f"   ❌ No audio_data key in response")
                    
                print(f"   Message: {data.get('message', 'N/A')}")
                print(f"   Voice Persona: {data.get('voice_persona', 'N/A')}")
            else:
                print(f"   ❌ Failed with status {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Raw response: {response.text[:200]}")
                    
        except Exception as e:
            print(f"   ❌ Exception: {str(e)}")

if __name__ == "__main__":
    test_speech_generation_detailed()