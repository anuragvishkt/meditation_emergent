#!/usr/bin/env python3
"""
Comprehensive Backend API Testing for Meditation Voice Assistant
Tests all endpoints and functionality described in the review request.
"""

import requests
import json
import sys
from datetime import datetime
import time

class MeditationAPITester:
    def __init__(self, base_url="https://734fc207-4da5-4704-b456-da1d73d27080.preview.emergentagent.com"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.session_id = None

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
        else:
            print(f"❌ {name} - FAILED: {details}")
        
        if details and success:
            print(f"   Details: {details}")

    def test_api_root(self):
        """Test the root API endpoint"""
        try:
            response = requests.get(f"{self.base_url}/api/", timeout=10)
            success = response.status_code == 200
            
            if success:
                data = response.json()
                details = f"Status: {response.status_code}, Message: {data.get('message', 'N/A')}"
            else:
                details = f"Status: {response.status_code}"
                
            self.log_test("API Root Endpoint", success, details)
            return success
            
        except Exception as e:
            self.log_test("API Root Endpoint", False, str(e))
            return False

    def test_voice_personas(self):
        """Test voice personas endpoint"""
        try:
            response = requests.get(f"{self.base_url}/api/voice-personas", timeout=10)
            success = response.status_code == 200
            
            if success:
                data = response.json()
                personas = data.get('personas', {})
                expected_personas = ['calm_female', 'wise_male', 'gentle_guide', 'nature_spirit', 'zen_master']
                
                # Check if all expected personas are present
                all_present = all(persona in personas for persona in expected_personas)
                
                if all_present:
                    details = f"Found {len(personas)} personas: {list(personas.keys())}"
                    # Verify persona structure
                    first_persona = list(personas.values())[0]
                    has_required_fields = all(field in first_persona for field in ['name', 'description'])
                    
                    if not has_required_fields:
                        success = False
                        details += " - Missing required fields in persona data"
                else:
                    success = False
                    details = f"Missing personas. Found: {list(personas.keys())}, Expected: {expected_personas}"
            else:
                details = f"Status: {response.status_code}"
                
            self.log_test("Voice Personas Endpoint", success, details)
            return success
            
        except Exception as e:
            self.log_test("Voice Personas Endpoint", False, str(e))
            return False

    def test_meditation_categories(self):
        """Test meditation categories endpoint"""
        try:
            response = requests.get(f"{self.base_url}/api/meditation-categories", timeout=10)
            success = response.status_code == 200
            
            if success:
                data = response.json()
                categories = data.get('categories', {})
                expected_categories = ['rainfall', 'ocean', 'forest', 'whitenoise', 'tibetan']
                
                # Check if all expected categories are present
                all_present = all(category in categories for category in expected_categories)
                
                if all_present:
                    details = f"Found {len(categories)} categories: {list(categories.keys())}"
                    # Verify category structure
                    first_category = list(categories.values())[0]
                    has_required_fields = all(field in first_category for field in ['name', 'keywords'])
                    
                    if not has_required_fields:
                        success = False
                        details += " - Missing required fields in category data"
                else:
                    success = False
                    details = f"Missing categories. Found: {list(categories.keys())}, Expected: {expected_categories}"
            else:
                details = f"Status: {response.status_code}"
                
            self.log_test("Meditation Categories Endpoint", success, details)
            return success
            
        except Exception as e:
            self.log_test("Meditation Categories Endpoint", False, str(e))
            return False

    def test_music_endpoints(self):
        """Test music endpoints for all categories"""
        categories = ['rainfall', 'ocean', 'forest', 'whitenoise', 'tibetan']
        all_success = True
        
        for category in categories:
            try:
                response = requests.get(f"{self.base_url}/api/music/{category}", timeout=15)
                success = response.status_code == 200
                
                if success:
                    data = response.json()
                    tracks = data.get('tracks', [])
                    category_name = data.get('name', 'Unknown')
                    
                    if tracks:
                        # Verify track structure
                        first_track = tracks[0]
                        required_fields = ['id', 'name', 'artist', 'external_url']
                        has_required_fields = all(field in first_track for field in required_fields)
                        
                        if has_required_fields:
                            details = f"Category: {category_name}, Found {len(tracks)} tracks"
                        else:
                            success = False
                            details = f"Missing required fields in track data for {category}"
                    else:
                        # Empty tracks might be OK if Spotify API has issues
                        details = f"Category: {category_name}, No tracks found (might be Spotify API issue)"
                else:
                    details = f"Status: {response.status_code}"
                    
                self.log_test(f"Music Endpoint - {category}", success, details)
                if not success:
                    all_success = False
                    
            except Exception as e:
                self.log_test(f"Music Endpoint - {category}", False, str(e))
                all_success = False
                
        return all_success

    def test_session_creation(self):
        """Test session creation endpoint"""
        try:
            session_data = {
                "voice_persona": "calm_female",
                "session_type": "guided_meditation",
                "duration_minutes": 30,
                "ambient_category": "rainfall"
            }
            
            response = requests.post(
                f"{self.base_url}/api/session", 
                json=session_data,
                timeout=10
            )
            success = response.status_code == 200
            
            if success:
                data = response.json()
                required_fields = ['id', 'user_id', 'voice_persona', 'session_type', 'duration_minutes', 'status']
                has_required_fields = all(field in data for field in required_fields)
                
                if has_required_fields:
                    self.session_id = data['id']
                    details = f"Session created with ID: {self.session_id}"
                else:
                    success = False
                    details = f"Missing required fields in session response. Got: {list(data.keys())}"
            else:
                details = f"Status: {response.status_code}"
                try:
                    error_data = response.json()
                    details += f", Error: {error_data}"
                except:
                    details += f", Response: {response.text[:200]}"
                
            self.log_test("Session Creation", success, details)
            return success
            
        except Exception as e:
            self.log_test("Session Creation", False, str(e))
            return False

    def test_session_retrieval(self):
        """Test session retrieval endpoint"""
        if not self.session_id:
            self.log_test("Session Retrieval", False, "No session ID available from creation test")
            return False
            
        try:
            response = requests.get(f"{self.base_url}/api/session/{self.session_id}", timeout=10)
            success = response.status_code == 200
            
            if success:
                data = response.json()
                details = f"Retrieved session: {data.get('id', 'Unknown ID')}, Status: {data.get('status', 'Unknown')}"
            else:
                details = f"Status: {response.status_code}"
                
            self.log_test("Session Retrieval", success, details)
            return success
            
        except Exception as e:
            self.log_test("Session Retrieval", False, str(e))
            return False

    def test_speech_generation(self):
        """Test speech generation endpoint"""
        try:
            speech_data = {
                "message": "Welcome to your meditation session",
                "voice_persona": "calm_female"
            }
            
            response = requests.post(
                f"{self.base_url}/api/generate-speech",
                json=speech_data,
                timeout=15
            )
            success = response.status_code == 200
            
            if success:
                data = response.json()
                has_audio = 'audio_data' in data and data['audio_data']
                
                if has_audio:
                    details = f"Generated speech for: '{speech_data['message'][:30]}...'"
                else:
                    success = False
                    details = "No audio data in response"
            else:
                details = f"Status: {response.status_code}"
                
            self.log_test("Speech Generation", success, details)
            return success
            
        except Exception as e:
            self.log_test("Speech Generation", False, str(e))
            return False

    def test_invalid_endpoints(self):
        """Test error handling with invalid requests"""
        tests = [
            ("Invalid music category", f"{self.base_url}/api/music/invalid_category", 400),
            ("Invalid session ID", f"{self.base_url}/api/session/invalid_id", 404),
            ("Non-existent endpoint", f"{self.base_url}/api/nonexistent", 404)
        ]
        
        all_success = True
        for test_name, url, expected_status in tests:
            try:
                response = requests.get(url, timeout=10)
                success = response.status_code == expected_status
                
                details = f"Expected {expected_status}, got {response.status_code}"
                self.log_test(f"Error Handling - {test_name}", success, details)
                
                if not success:
                    all_success = False
                    
            except Exception as e:
                self.log_test(f"Error Handling - {test_name}", False, str(e))
                all_success = False
                
        return all_success

    def run_all_tests(self):
        """Run all backend tests"""
        print("🧘 Starting Meditation Voice Assistant Backend API Tests")
        print("=" * 60)
        
        # Test basic connectivity first
        if not self.test_api_root():
            print("\n❌ API root endpoint failed - backend may not be running")
            return False
            
        # Core API tests
        self.test_voice_personas()
        self.test_meditation_categories()
        self.test_music_endpoints()
        self.test_session_creation()
        self.test_session_retrieval()
        self.test_speech_generation()
        self.test_invalid_endpoints()
        
        # Summary
        print("\n" + "=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} tests passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All backend tests passed!")
            return True
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed")
            return False

def main():
    """Main test execution"""
    print("Starting Meditation Voice Assistant Backend Testing...")
    print(f"Testing against: https://734fc207-4da5-4704-b456-da1d73d27080.preview.emergentagent.com")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    tester = MeditationAPITester()
    success = tester.run_all_tests()
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())