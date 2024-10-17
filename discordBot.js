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

// Load environment variables
dotenv.config();

console.log(process.env.DISCORD_TOKEN);

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

// Listen for messages
client.on('messageCreate', async (message) => {
    // Ignore messages from bots
    if (message.author.bot) return;

    if (message.content.trim().includes('has anyone')) {
        content = message.content.split('has anyone');
        content = content[1].trim();
        content = content.replace(/ /g, '+');
        message.reply("Have you ever tried to google it? 🙄 https://www.google.com/search?q=" + content);
    }

    if (message.mentions.has(client.user)) {
        const botCapabilities = [
            "I can roast users when you mention them and include the word 'ROAST'.",
            "I can search for similar questions and provide answers.",
            "I can respond to your messages and help with various tasks."
        ];

        const botMentionedWithQuestion = ["what can you do", "what are your capabilities", "what can you help with", "what do you do", "help"];
        const messageContent = message.content.toLowerCase();

        if (botMentionedWithQuestion.some(phrase => messageContent.includes(phrase))) {
            message.reply(`Here are some things I can do:\n- ${botCapabilities.join('\n- ')}`);
        }
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
