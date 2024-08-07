from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import date
from pydantic import BaseModel
from setup_db import SessionLocal, Mood, Activity
app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)
class MoodCreate(BaseModel):
    mood: str

class ActivityCreate(BaseModel):
    activity: str

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.post("/api/mood")
def create_mood(mood: MoodCreate, db: Session = Depends(get_db)):
    db_mood = Mood(date=date.today(), mood=mood.mood)
    db.add(db_mood)
    db.commit()
    db.refresh(db_mood)
    return db_mood

@app.get("/api/mood")
def read_moods(db: Session = Depends(get_db)):
    return db.query(Mood).all()

@app.post("/api/activity")
def create_activity(activity: ActivityCreate, db: Session = Depends(get_db)):
    db_activity = Activity(date=date.today(), activity=activity.activity)
    db.add(db_activity)
    db.commit()
    db.refresh(db_activity)
    return db_activity

@app.get("/api/activity")
def read_activities(db: Session = Depends(get_db)):
    return db.query(Activity).all()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
