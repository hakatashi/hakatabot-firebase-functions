import {v2 as cloudinary} from 'cloudinary';
import {defineString} from 'firebase-functions/params';

const CLOUDINARY_CLOUD_NAME = defineString('CLOUDINARY_CLOUD_NAME');
const CLOUDINARY_API_KEY = defineString('CLOUDINARY_API_KEY');
const CLOUDINARY_API_SECRET = defineString('CLOUDINARY_API_SECRET');

cloudinary.config({
	cloud_name: CLOUDINARY_CLOUD_NAME.value(),
	api_key: CLOUDINARY_API_KEY.value(),
	api_secret: CLOUDINARY_API_SECRET.value(),
});

export default cloudinary;
