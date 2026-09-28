import axios from 'axios';
import {info as logInfo, warn as logWarn} from 'firebase-functions/logger';

export interface InstagramEngagement {
	impressions: number;
	likes: number;
	comments: number;
}

export interface InstagramMedia {
	id: string;
	caption: string;
	media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
	media_url: string;
	permalink: string;
	timestamp: string;
	like_count?: number;
	comments_count?: number;
}

interface InstagramInsightMetric {
	name: string;
	values: {value: number}[];
}

export const getLatestInstagramVideoEngagements = async (accessToken: string): Promise<{volume: string, engagements: InstagramEngagement}[]> => {
	try {
		// Get user's media using Instagram Basic Display API
		const mediaResponse = await axios.get('https://graph.instagram.com/me/media', {
			params: {
				fields: 'id,caption,media_type,media_url,permalink,timestamp',
				access_token: accessToken,
				limit: 50, // Get up to 50 recent posts
			},
		});

		if (!mediaResponse.data.data || mediaResponse.data.data.length === 0) {
			throw new Error('No media found for the Instagram account');
		}

		// Filter for VIDEO type media (reels/videos)
		const videoMedia: InstagramMedia[] = mediaResponse.data.data.filter((media: InstagramMedia) => media.media_type === 'VIDEO');

		if (videoMedia.length === 0) {
			throw new Error('No video content found in recent posts');
		}

		logInfo(`[getLatestInstagramVideoEngagements] Found ${videoMedia.length} video posts`);

		// Get detailed insights for each video
		const engagementByVolume = new Map<string, InstagramEngagement>();

		for (const video of videoMedia) {
			// Extract volume number from caption (format: "#number")
			const caption = video.caption || '';
			const volumeMatch = caption.match(/#(?<volume>\d+)/);
			if (!volumeMatch || !volumeMatch.groups) {
				continue; // Skip videos without volume numbers
			}
			const volume = volumeMatch.groups.volume;

			try {
				logInfo(`[getLatestInstagramVideoEngagements] Fetching insights for video ID: ${video.id}`);

				// Get insights for the video
				const insightsResponse = await axios.get(`https://graph.instagram.com/${video.id}/insights`, {
					params: {
						metric: 'views,comments,likes',
						access_token: accessToken,
					},
				});

				// Parse engagement metrics
				const insights = insightsResponse.data.data;
				const impressions = insights.find((metric: InstagramInsightMetric) => metric.name === 'views')?.values[0]?.value || 0;
				const likes = insights.find((metric: InstagramInsightMetric) => metric.name === 'likes')?.values[0]?.value || 0;
				const comments = insights.find((metric: InstagramInsightMetric) => metric.name === 'comments')?.values[0]?.value || 0;

				// Aggregate engagement by volume
				const existing = engagementByVolume.get(volume) || {impressions: 0, likes: 0, comments: 0};
				engagementByVolume.set(volume, {
					impressions: existing.impressions + impressions,
					likes: existing.likes + likes,
					comments: existing.comments + comments,
				});
			} catch (insightError: unknown) {
				// Instagram Basic Display API might not have access to insights
				// Fall back to public metrics if available
				const errorData = (insightError as {response?: {data?: unknown}})?.response?.data || insightError;
				logWarn(`Could not get insights for video ${video.id}:`, errorData);

				// Try to get basic metrics from the media object itself
				const existing = engagementByVolume.get(volume) || {impressions: 0, likes: 0, comments: 0};

				// Note: Basic Display API doesn't provide view counts or detailed metrics
				// This is a limitation of the API - you'd need Instagram Graph API for business accounts
				engagementByVolume.set(volume, {
					impressions: existing.impressions, // Not available in Basic Display API
					likes: existing.likes + (video.like_count || 0),
					comments: existing.comments + (video.comments_count || 0),
				});
			}
		}
		// Convert to array and sort by volume number (newest first - highest number first)
		return Array.from(engagementByVolume.entries())
			.sort(([a], [b]) => Number.parseInt(b) - Number.parseInt(a))
			.map(([volume, engagements]) => ({volume, engagements}));
	} catch (error) {
		throw new Error(`Failed to fetch Instagram video engagements: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
};
