import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile } from "firebase/auth";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, query, where, addDoc, serverTimestamp, getDocFromServer, deleteDoc, orderBy, limit, getDocs, writeBatch } from "firebase/firestore";
// @ts-ignore
import firebaseConfig from "../firebase-applet-config.json";

let app;
let auth: any;
let db: any;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
} catch (e) {
  console.error("[Firebase Frontend] Initialization failed. App will rely on Supabase.", e);
  // Create mock/null exports to prevent runtime crashes
  app = null;
  auth = { currentUser: null, onAuthStateChanged: () => () => {} };
  db = null;
}

export { auth, db };
export const googleProvider = new GoogleAuthProvider();

export const signIn = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    if (db) {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        console.log("[Auth] Creating new user profile for:", user.uid, user.email);
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || user.email?.split('@')[0] || "Guest User",
          role: "guest",
          onboardingStatus: "none",
          createdAt: serverTimestamp(),
          memberNumber: `TMP-${Math.floor(1000 + Math.random() * 9000)}`
        });
      } else {
        console.log("[Auth] Existing user signed in:", user.uid);
      }
    }
    return result;
  } catch (error) {
    console.error("[Auth] Sign-in error:", error);
    throw error;
  }
};
export const logOut = () => signOut(auth);

export const signUpWithEmail = async (email: string, password: string, displayName: string) => {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    const user = result.user;
    
    await updateProfile(user, { displayName });

    if (db) {
      const userRef = doc(db, "users", user.uid);
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: displayName || "Guest User",
        role: "guest",
        onboardingStatus: "none",
        createdAt: serverTimestamp(),
        memberNumber: `TMP-${Math.floor(1000 + Math.random() * 9000)}`
      });
    }
    return result;
  } catch (error) {
    console.error("[Auth] Sign-up with email error:", error);
    throw error;
  }
};

export const signInWithEmail = async (email: string, password: string) => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result;
  } catch (error) {
    console.error("[Auth] Sign-in with email error:", error);
    throw error;
  }
};

export const resetPassword = async (email: string) => {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    console.error("[Auth] Password reset error:", error);
    throw error;
  }
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error: any) {
    if (error.message?.includes("the client is offline")) {
      console.error("Firebase configuration error: client is offline.");
    }
  }
}
testConnection();

export const safeCollection = (db: any, path: string) => db ? collection(db, path) : null;
export const safeDoc = (db: any, path: string, id?: string) => {
  if (!db) return null;
  return id ? doc(db, path, id) : doc(db, path);
};
export const safeQuery = (coll: any, ...constraints: any[]) => coll ? query(coll, ...constraints) : null;
export const safeOnSnapshot = (ref: any, onNext: any, onError?: any) => {
  if (!ref) return () => {};
  return onSnapshot(ref, onNext, onError);
};

export {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  addDoc,
  serverTimestamp,
  deleteDoc,
  orderBy,
  limit,
  getDocs,
  writeBatch
};
