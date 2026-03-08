import OpenAI from "openai";
import { config } from "../config.js";

let client: OpenAI | null = null;

export function getOpenRouterClient(): OpenAI {
	if (!client) {
		client = new OpenAI({
			baseURL: "https://openrouter.ai/api/v1",
			apiKey: config.openrouter.apiKey,
		});
	}
	return client;
}
