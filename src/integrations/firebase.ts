import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCG4Xx-lTssXc9X7N1uqLLmaoILZRe2P7c",
  authDomain: "fisco-9d7d5.firebaseapp.com",
  projectId: "fisco-9d7d5",
  storageBucket: "fisco-9d7d5.firebasestorage.app",
  messagingSenderId: "181863074437",
  appId: "1:181863074437:web:cf8fa8889a3bdee469f7ec",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

export const firebaseAuthApi = {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  firebaseSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  OAuthProvider,
};

export type { FirebaseUser };
