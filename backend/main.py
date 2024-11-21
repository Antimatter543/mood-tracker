from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import date
from backend.setup_db import SessionLocal, User, Entry, Activity, Image

app = FastAPI()

# Dependency for database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Pydantic models for input validation
class UserCreate(BaseModel):
    username: str
    email: str

class EntryCreate(BaseModel):
    user_id: int
    date: date
    mood: float
    notes: str = None

class ActivityCreate(BaseModel):
    entry_id: int
    activity: str

class ImageCreate(BaseModel):
    entry_id: int
    file_path: str

# User Routes
@app.post("/users/")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = User(username=user.username, email=user.email)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

# Entry Routes
@app.post("/entries/")
def create_entry(entry: EntryCreate, db: Session = Depends(get_db)):
    db_entry = Entry(user_id=entry.user_id, date=entry.date, mood=entry.mood, notes=entry.notes)
    db.add(db_entry)
    db.commit()
    db.refresh(db_entry)
    return db_entry

@app.get("/entries/")
def read_entries(db: Session = Depends(get_db)):
    return db.query(Entry).all()

# Activity Routes
@app.post("/activities/")
def create_activity(activity: ActivityCreate, db: Session = Depends(get_db)):
    db_activity = Activity(entry_id=activity.entry_id, activity=activity.activity)
    db.add(db_activity)
    db.commit()
    db.refresh(db_activity)
    return db_activity

@app.get("/activities/")
def read_activities(db: Session = Depends(get_db)):
    return db.query(Activity).all()

# Image Routes
@app.post("/images/")
def create_image(image: ImageCreate, db: Session = Depends(get_db)):
    db_image = Image(entry_id=image.entry_id, file_path=image.file_path)
    db.add(db_image)
    db.commit()
    db.refresh(db_image)
    return db_image

@app.get("/images/")
def read_images(db: Session = Depends(get_db)):
    return db.query(Image).all()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
