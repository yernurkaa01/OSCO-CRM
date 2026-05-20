require("dotenv").config()
const OpenAI = require("openai")

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

async function main() {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: "Скажи одним словом: работает ли API?" }
      ],
    })

    console.log(res.choices[0].message.content)

  } catch (err) {
    console.error("Ошибка:", err.message)
  }
}

main()