const OpenAI = require('openai');

class WandbInferenceClient {
    constructor(options = {}) {
        this.apiKey = options.apiKey;
        this.project = options.project;
        this.client = null;
        this.models = [];
    }

    async initialize() {
        if (!this.apiKey) {
            throw new Error('WandB API key is required');
        }

        if (!this.project) {
            throw new Error('WandB project is required (format: team/project)');
        }

        this.client = new OpenAI({
            baseURL: 'https://api.inference.wandb.ai/v1',
            apiKey: this.apiKey,
            project: this.project,
            defaultHeaders: {
                'OpenAI-Project': this.project
            }
        });

        // Test the connection and get available models
        await this.loadModels();
        console.log('WandB Inference client initialized');
    }

    async loadModels() {
        try {
            const response = await this.client.models.list();
            this.models = response.data || [];
            console.log(`Loaded ${this.models.length} WandB models:`, this.models.map(m => m.id));
        } catch (error) {
            console.error('Error loading WandB models:', error);
            
            // Provide more helpful error messages
            if (error.status === 401) {
                if (error.error?.message?.includes('missing project header')) {
                    throw new Error('WandB project header is missing. Please check your project format (team/project).');
                } else if (error.error?.message?.includes('invalid for this project')) {
                    throw new Error('WandB API key is invalid for this project. Please check your credentials.');
                } else {
                    throw new Error('WandB authentication failed. Please check your API key and project settings.');
                }
            }
            
            // Set fallback models if API call fails for other reasons
            console.log('Using fallback models due to API error');
            this.models = [
                { id: 'meta-llama/Llama-3.1-8B-Instruct', object: 'model' },
                { id: 'deepseek-ai/DeepSeek-V2.5', object: 'model' },
                { id: 'meta-llama/Llama-3.1-70B-Instruct', object: 'model' }
            ];
        }
    }

    getAvailableModels() {
        return this.models.map(model => ({
            id: model.id,
            name: model.id,
            description: `WandB model: ${model.id}`
        }));
    }

    async createMessage(options) {
        if (!this.client) {
            throw new Error('WandB client not initialized');
        }

        const {
            model = 'meta-llama/Llama-3.1-8B-Instruct',
            messages,
            max_tokens = 4000,
            temperature = 0.7,
            stream = false,
            tools = []
        } = options;

        // Convert Anthropic-style messages to OpenAI format if needed
        const formattedMessages = this.formatMessages(messages);

        const requestOptions = {
            model,
            messages: formattedMessages,
            max_tokens,
            temperature,
            stream
        };

        // Note: WandB Inference may not support tools yet, but we'll include them in case
        if (tools && tools.length > 0) {
            requestOptions.tools = this.formatTools(tools);
        }

        if (stream) {
            return this.client.chat.completions.create(requestOptions);
        } else {
            const response = await this.client.chat.completions.create(requestOptions);
            return response;
        }
    }

    formatMessages(messages) {
        return messages.map(message => {
            if (typeof message.content === 'string') {
                return {
                    role: message.role,
                    content: message.content
                };
            } else if (Array.isArray(message.content)) {
                // Handle complex content blocks (e.g., text + images)
                const textContent = message.content
                    .filter(block => block.type === 'text')
                    .map(block => block.text)
                    .join('\n');
                
                return {
                    role: message.role,
                    content: textContent
                };
            }
            return message;
        });
    }

    formatTools(tools) {
        // Convert Anthropic-style tools to OpenAI format
        return tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema || {
                    type: 'object',
                    properties: {},
                    additionalProperties: false
                }
            }
        }));
    }

    async *stream(options) {
        const stream = await this.createMessage({ ...options, stream: true });
        
        for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
                yield {
                    type: 'content_block_delta',
                    delta: {
                        type: 'text_delta',
                        text: chunk.choices[0].delta.content
                    }
                };
            }
            
            // Handle function calls if supported
            if (chunk.choices[0]?.delta?.tool_calls) {
                const toolCall = chunk.choices[0].delta.tool_calls[0];
                if (toolCall) {
                    let input = {};
                    
                    // Safely parse JSON arguments, handling partial/malformed JSON in streaming
                    if (toolCall.function?.arguments) {
                        try {
                            input = JSON.parse(toolCall.function.arguments);
                        } catch (parseError) {
                            console.warn('Failed to parse tool call arguments:', toolCall.function.arguments, parseError);
                            // In streaming, arguments might be partial - skip this chunk and wait for complete data
                            continue;
                        }
                    }
                    
                    yield {
                        type: 'content_block_start',
                        content_block: {
                            type: 'tool_use',
                            id: toolCall.id,
                            name: toolCall.function?.name,
                            input: input
                        }
                    };
                }
            }
        }
    }
}

module.exports = WandbInferenceClient;