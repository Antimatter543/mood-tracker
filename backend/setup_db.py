from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

DATABASE_URL = "sqlite:///./mood_tracker.db"

# Database setup
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Users Table: Stores user information
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)  # User ID
    username = Column(String, unique=True, nullable=False)  # Username
    email = Column(String, unique=True, nullable=False)  # Email address

    # Relationship with entries
    entries = relationship("Entry", back_populates="user")

# Entries Table: Stores mood, notes, and links to activities and images
class Entry(Base):
    __tablename__ = "entries"
    id = Column(Integer, primary_key=True, index=True)  # Entry ID
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # Link to Users table
    date = Column(Date, nullable=False, unique=True)  # Entry date
    mood = Column(Float, nullable=False)  # Mood as a float (0-10 scale)
    notes = Column(Text)  # Optional notes for the day

    # Relationships
    user = relationship("User", back_populates="entries")
    activities = relationship("Activity", back_populates="entry", cascade="all, delete-orphan")
    images = relationship("Image", back_populates="entry", cascade="all, delete-orphan")

# Activities Table: Stores activities associated with an entry
class Activity(Base):
    __tablename__ = "activities"
    id = Column(Integer, primary_key=True, index=True)  # Activity ID
    entry_id = Column(Integer, ForeignKey("entries.id"), nullable=False)  # Link to Entries table
    activity = Column(String, nullable=False)  # Description of the activity

    entry = relationship("Entry", back_populates="activities")

# Images Table: Stores image file paths associated with an entry
class Image(Base):
    __tablename__ = "images"
    id = Column(Integer, primary_key=True, index=True)  # Image ID
    entry_id = Column(Integer, ForeignKey("entries.id"), nullable=False)  # Link to Entries table
    file_path = Column(Text, nullable=False)  # Path to the stored image

    entry = relationship("Entry", back_populates="images")

# Create tables in the database
Base.metadata.create_all(bind=engine)
