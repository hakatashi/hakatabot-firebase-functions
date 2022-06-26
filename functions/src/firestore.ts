import type {DocumentReference} from '@google-cloud/firestore';
import firebase from 'firebase-admin';

firebase.initializeApp();

export const db = firebase.firestore();
export const GoogleTokens = db.collection('google-tokens');
export const GoogleFoodPhotos = db.collection('google-food-photos');
export const FitbitTokens = db.collection('fitbit-tokens');
export const FitbitActivities = db.collection('fitbit-activities');
export const FitbitSleeps = db.collection('fitbit-sleeps');
export const AnimeWatchRecords = db.collection('anime-watch-records');
export const States = db.collection('states');

export class State {
	doc: DocumentReference;

	constructor(name: string) {
		this.doc = States.doc(name);
	}

	set(value: {[name: string]: any}) {
		return this.doc.set(value, {merge: true});
	}

	async get<T>(name: string): Promise<T | undefined>;

	async get<T>(name: string, defaultValue: T): Promise<T>;

	async get<T>(name: string, defaultValue?: T): Promise<T | undefined> {
		const data = await this.doc.get();
		if (data.exists) {
			return data.get(name);
		}
		if (defaultValue !== undefined) {
			return defaultValue;
		}
		return undefined;
	}
}
