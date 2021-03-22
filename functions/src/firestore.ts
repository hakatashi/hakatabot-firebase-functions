import firebase from 'firebase-admin';
import type {DocumentReference} from '@google-cloud/firestore';



firebase.initializeApp();

export const db = firebase.firestore();
export const GoogleTokens = db.collection('google-tokens');
export const GoogleFoodPhotos = db.collection('google-food-photos');
export const States = db.collection('states');

export class State {
	name: string;
	doc: DocumentReference;
	constructor(name: string) {
		this.name = name;
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
		} else {
			return undefined;
		}
	}
}