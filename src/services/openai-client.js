const OpenAI = require('openai');

class OpenAIClient {
    constructor(options = {}) {
        this.apiKey = options.apiKey;
        this.client = null;
        this.models = [];
    }

    async initialize() {
        if (!this.apiKey) {
            throw new Error('OpenAI API key is required');
        }

        this.client = new OpenAI({
            apiKey: this.apiKey
        });

        // Test the connection and get available models
        await this.loadModels();
        console.log('OpenAI client initialized');
    }

    async loadModels() {
        try {
            const response = await this.client.models.list();
            // Filter to only include chat completion models
            this.models = response.data.filter(model => 
                model.id.includes('gpt-') || 
                model.id.includes('o1-') ||
                model.id.includes('chatgpt')
            );
            console.log(`Loaded ${this.models.length} OpenAI models:`, this.models.map(m => m.id));
        } catch (error) {
            console.error('Error loading OpenAI models:', error);
            
            // Provide more helpful error messages
            if (error.status === 401) {
                throw new Error('OpenAI API key is invalid. Please check your credentials.');
            }
            
            // Set fallback models if API call fails for other reasons
            console.log('Using fallback OpenAI models due to API error');
            this.models = [
                { id: 'gpt-4o', object: 'model' },
                { id: 'gpt-4o-mini', object: 'model' },
                { id: 'gpt-4-turbo', object: 'model' },
                { id: 'gpt-3.5-turbo', object: 'model' }
            ];
        }
    }

    getAvailableModels() {
        return this.models.map(model => ({
            id: model.id,
            name: model.id,
            description: `OpenAI model: ${model.id}`
        }));
    }

    async createMessage(options) {
        if (!this.client) {
            throw new Error('OpenAI client not initialized');
        }

        const {
            model = 'gpt-4o',
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

        // Add tools if provided
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
                // Handle complex content blocks (text, tool_use, tool_result)
                let textParts = [];
                
                for (const block of message.content) {
                    if (block.type === 'text') {
                        textParts.push(block.text);
                    } else if (block.type === 'tool_use') {
                        // Format tool usage for OpenAI
                        textParts.push(`[Used tool: ${block.name} with input: ${JSON.stringify(block.input)}]`);
                    } else if (block.type === 'tool_result') {
                        // Format tool results for OpenAI 
                        const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                        textParts.push(`[Tool result: ${content}]`);
                    }
                }
                
                return {
                    role: message.role,
                    content: textParts.join('\n')
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
        
        // Track accumulated tool call data across chunks
        const toolCallBuffer = new Map();
        
        let chunkCount = 0;
        for await (const chunk of stream) {
            chunkCount++;
            console.log(`[OpenAI Stream] Chunk ${chunkCount}:`, JSON.stringify(chunk, null, 2));
            
            if (chunk.choices[0]?.delta?.content) {
                console.log(`[OpenAI Stream] Content found:`, chunk.choices[0].delta.content);
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
                if (toolCall && toolCall.id) {
                    // Initialize or update tool call buffer
                    if (!toolCallBuffer.has(toolCall.id)) {
                        toolCallBuffer.set(toolCall.id, {
                            id: toolCall.id,
                            name: toolCall.function?.name || '',
                            arguments: ''
                        });
                    }
                    
                    const bufferedCall = toolCallBuffer.get(toolCall.id);
                    
                    // Accumulate function name and arguments
                    if (toolCall.function?.name) {
                        bufferedCall.name = toolCall.function.name;
                    }
                    if (toolCall.function?.arguments) {
                        bufferedCall.arguments += toolCall.function.arguments;
                    }
                    
                    // Try to parse complete JSON arguments
                    if (bufferedCall.arguments) {
                        try {
                            const input = JSON.parse(bufferedCall.arguments);
                            
                            // Successfully parsed complete JSON - yield the tool use
                            yield {
                                type: 'content_block_start',
                                content_block: {
                                    type: 'tool_use',
                                    id: bufferedCall.id,
                                    name: bufferedCall.name,
                                    input: input
                                }
                            };
                            
                            // Remove from buffer once processed
                            toolCallBuffer.delete(toolCall.id);
                        } catch (parseError) {
                            // JSON not complete yet, continue accumulating
                            continue;
                        }
                    }
                }
            }
        }
        
        console.log(`[OpenAI Stream] Stream ended after ${chunkCount} chunks`);
    }
}

module.exports = OpenAIClient;