import firebase from 'firebase-admin';

firebase.initializeApp();

export const db = firebase.firestore();
export const GoogleTokens = db.collection('google-tokens');
export const GoogleFoodPhotos = db.collection('google-food-photos');
