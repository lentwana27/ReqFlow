import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

enum OperationType {
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
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      // Since we use Supabase for auth mostly, this might be null if not logged into Firebase
      msg: 'Check firestore.rules and authentication state.'
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const brandingService = {
  getLogo: async (): Promise<string | null> => {
    const path = 'settings/branding';
    try {
      const docRef = doc(db, 'settings', 'branding');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data().logo || null;
      }
      return null;
    } catch (err) {
      if (err instanceof Error && err.message.includes('permission')) {
        // We log but don't crash the whole app load if logo fails to fetch
         console.warn('[Branding] Failed to fetch logo from Firestore:', err);
      }
      return null;
    }
  },
  saveLogo: async (base64Data: string) => {
    const path = 'settings/branding';
    try {
      const docRef = doc(db, 'settings', 'branding');
      await setDoc(docRef, { 
        logo: base64Data,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }
};
