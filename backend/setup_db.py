from sqlalchemy import create_engine, Column, Integer, String, Date
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "sqlite:///./mood_tracker.db"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Mood(Base):
    __tablename__ = 'moods'
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, index=True)
    mood = Column(String, index=True)

class Activity(Base):
    __tablename__ = 'activities'
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, index=True)
    activity = Column(String, index=True)

Base.metadata.create_all(bind=engine)
