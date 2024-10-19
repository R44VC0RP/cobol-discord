// Add this at the top of your file, before other requires
process.emitWarning = function () {};

const {
    Client,
    GatewayIntentBits
} = require('discord.js');
const dotenv = require('dotenv');
const {
    getSimilarity
} = require('calculate-string-similarity');
const OpenAI = require('openai');
const natural = require('natural');
const levenshtein = require('fast-levenshtein');
const Redis = require('ioredis');

// Load environment variables
dotenv.config();

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// When the client is ready, run this code (only once)
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

const tokenizer = new natural.WordTokenizer();
const questionsMap = new Map();

function normalize(text) {
    text = text.toLowerCase();
    text = text.replace(/[^\w\s]/g, '');
    const tokens = tokenizer.tokenize(text);
    const stemmedTokens = tokens.map(token => natural.PorterStemmer.stem(token));
    return stemmedTokens.join(' ');
}

function addQuestion(originalText) {
    const normalizedText = normalize(originalText);
    questionsMap.set(normalizedText, (questionsMap.get(normalizedText) || 0) + 1);
}

function getQuestionCount(originalText) {
    const normalizedText = normalize(originalText);
    return questionsMap.get(normalizedText) || 0;
}

function isSimilar(question1, question2, threshold = 3) {
    return levenshtein.get(normalize(question1), normalize(question2)) <= threshold;
}

function findSimilarQuestions(question) {
    const similarQuestions = [];
    for (const [storedQuestion, count] of questionsMap.entries()) {
        if (isSimilar(question, storedQuestion)) {
            similarQuestions.push({ question: storedQuestion, count });
        }
    }
    return similarQuestions.sort((a, b) => b.count - a.count).slice(0, 5);
}

// Create Redis client
const redis = new Redis(process.env.REDIS_URL);

// Listen for messages
client.on('messageCreate', async (message) => {
    // Ignore messages from bots
    if (message.author.bot) return;

    if (message.mentions.has(client.user) && message.content.trim().includes('help')) {
        const botCapabilities = [
            "I can roast users when you mention them and include the word 'ROAST'.",
            "I can respond to your messages and help with various tasks.",
            "I can answer questions and help with various tasks. Use !ask <question> to ask me a question."
        ];

        message.reply(`Here are some things I can do:\n- ${botCapabilities.join('\n- ')}`);
    }

    if (message.content.trim().includes('has anyone')) {
        content = message.content.split('has anyone');
        content = content[1].trim();
        content = content.replace(/ /g, '+');
        message.reply("Have you ever tried to google it? 🙄 https://www.google.com/search?q=" + content);
    }

    if (message.content.trim().includes('confused')) {
        message.reply("Well, that's what you get for not using ChatGPT. 😏");
    }

    if (message.content.trim().includes('i dont understand', 'i dont know', 'i dont know how', 'i dont know how to')) {
        message.reply("Well lets think about that. What do you think you should have done instead?");
    }

    if (message.content.trim().includes('anyone have any solution', 'anyone have any ideas', 'anyone know how to', 'have solution', 'know how to')) {
        message.reply("Comon now <@769025576605319188> is teaching us to learn, not ask stupid questions.");
    }

    if (message.content.trim().includes('!ask')) {
        const content = message.content.split('!ask')[1].trim();
        
        // Fetch the last 10 messages as context
        const contextMessages = await message.channel.messages.fetch({ limit: 11 }); // 11 to include the current message
        const context = contextMessages
            .filter(msg => msg.id !== message.id) // Exclude the current message
            .map(msg => `${msg.author.username}: ${msg.content}`)
            .reverse()
            .join('\n');

        const prompt = `Context of recent messages:\n${context}\n\nUser question: ${content}`;
        
        const response = await getGPTResponse(prompt, `
            I need you to answer the question based off the most recent message and context provided. 
            But when you are replying answer in the same tone, style and length of the last message in the context provided to fit in, so if the last messages have had lower length, you should too. 
            also try to match the capitalization of the last messages in the context provided. 
            DO NOT START IT WITH "scobol: " or anything like that, just start with your response.
            for your response, just response, do not include a name or anything else, just the response to the question.

            Like if you were gonna reply with "scobol: Totally! I think emojis add a fun layer to communication. They can really make things more engaging! What do you think?"
            you would actually reply with "yeah, i think so too"

            Remember you are in a discord chat, so use the correct formatting and emojis (rarely).

            Do not act too friendly, you are a tired college student who is just trying to chat
            `);
        message.reply(response);
    }

    if (message.content.trim().includes('normal classroom', 'lab')) {
        message.reply("Do not be asking those questions man, cmon now, go to canvas and look at announcements. You're embarrassing yourself.")
    }

    if (message.content.toUpperCase().includes("ROAST")) {
        const roastees = message.mentions.users
            .filter(user => user.id !== process.env.DISCORD_CLIENT_ID);

        const roasteeInfo = await Promise.all(roastees.map(async user => {
            const recentMessages = await fetchRecentMessages(user.id, message.guild);
            return {
                id: user.id,
                username: user.username,
                recentMessages: recentMessages
            };
        }));

        const roastContext = roasteeInfo.map(info => 
            `User: ${info.username}\nRecent messages:\n${info.recentMessages.join('\n')}`
        ).join('\n\n');

        const roastPrompt = `You are a roast master. Do not hold back and provide the entire message. Assume they are smart and shouldn't be asking stupid or simple questions. This is a programmer class, so make the roasts actually funny and not corny. Roast the following users based on their recent messages:\n\n${roastContext}\n\nWhen you want to tag a user, use <@id> where id is the id of the user provided. Do not ramble on and on, just provide the roast and nothing else. Make it short and concise.`;

        const roast = await getGPTResponse(message.content, roastPrompt);
        message.reply(roast);
    }

    // Check if the message ends with a question mark
    if (message.content.trim().includes('!help')) {
        const userQuestion = message.content.trim();
        const similarQuestions = findSimilarQuestions(userQuestion);
        
        if (similarQuestions.length > 0) {
            const response = formatSimilarQuestionsResponse(similarQuestions);
            message.reply(response);
        } else {
            message.reply("This question hasn't been asked before.");
        }
        
        // Add the question to the Map for tracking
        addQuestion(userQuestion);
    }

    if (message.content.startsWith('!remember')) {
        const content = message.content.slice('!remember'.length).trim();
        if (content) {
            await redis.lpush('memories', JSON.stringify({
                userId: message.author.id,
                username: message.author.username,
                content: content,
                timestamp: Date.now()
            }));
            message.reply("I've added that to our collective memory!");
        } else {
            message.reply("Please provide something to remember after the !remember command.\n\nExample: !remember I need to buy groceries tomorrow.\n\nYou can also use !recall to see what you've remembered.\n\nYou can also use !repop to remove a memory.");
        }
    }

    if (message.content === '!recall') {

        const memories = await redis.lrange('memories', 0, 14);
        if (memories.length > 0) {
            const formattedMemories = memories.map((memory, index) => {
                const { username, content, timestamp } = JSON.parse(memory);
                const date = new Date(timestamp).toLocaleString();
                return `${index + 1}. ${username}: ${content} (${date})`;
            }).join('\n');
            message.reply(`Here are the last ${memories.length} memories:\n${formattedMemories}`);
        } else {
            message.reply("There's nothing in our collective memory yet.");
        }
    }

    if (message.content.startsWith('!repop')) {
        const index = parseInt(message.content.split(' ')[1]) - 1;
        if (isNaN(index) || index < 0 || index > 14) {
            message.reply("Please provide a valid number between 1 and 15.");
            return;
        }

        const memories = await redis.lrange('memories', 0, 14);
        if (index >= memories.length) {
            message.reply("That memory doesn't exist.");
            return;
        }

        const removedMemory = JSON.parse(memories[index]);
        await redis.lrem('memories', 1, JSON.stringify(removedMemory));
        message.reply(`Removed memory: ${removedMemory.username}: ${removedMemory.content}`);
    }

    // ... existing code ...
});

function formatSimilarQuestionsResponse(similarQuestions) {
    const totalOccurrences = similarQuestions.reduce((sum, { count }) => sum + count, 0);
    const questionList = similarQuestions
        .map(({ question, count }) => `- "${question}" (${count} time${count > 1 ? 's' : ''})`)
        .join('\n');

    return `I found ${totalOccurrences} occurrence${totalOccurrences > 1 ? 's' : ''} of similar questions:\n${questionList}`;
}



// Add the GPT response function
async function getGPTResponse(message, systemPrompt) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: message
                },
            ],
        });

        let reponse = completion.choices[0].message;
        console.log(reponse);
        return reponse;
    } catch (error) {
        console.error("Error getting GPT response:", error);
        return "Sorry, I couldn't generate a response at the moment.";
    }
}

// Add this new function to fetch recent messages
async function fetchRecentMessages(userId, guild) {
    const channels = guild.channels.cache.filter(channel => channel.type === 0); // 0 is for text channels
    let recentMessages = [];

    for (const channel of channels.values()) {
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const userMessages = messages.filter(msg => msg.author.id === userId);
            recentMessages.push(...userMessages.map(msg => msg.content));

            if (recentMessages.length >= 20) {
                break;
            }
        } catch (error) {
            console.error(`Error fetching messages from channel ${channel.name}:`, error);
        }
    }

    return recentMessages.slice(0, 20);
}

// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);

