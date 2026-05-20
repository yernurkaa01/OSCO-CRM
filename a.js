app.post("/send", (req, res) => {

const { name, phone } = req.body

const date = new Date().toLocaleString()
const data = `${date} | ${name} - ${phone}\n`

fs.appendFileSync("data.txt", data)

console.log("Сохранено:", name, phone)



const TOKEN = "8253766570:AAGcOG5nZS7jgvb3yRy7vAT3mtQ9BpvhXn0"
const CHAT_ID = "5563420792"

const message = `Новая заявка:\nИмя: ${name}\nТелефон: ${phone}`

axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
chat_id: CHAT_ID,
text: message
})
.catch(err => console.error("TG error:", err))


res.json({ status: "ok" })

})







const mongoose = require('mongoose')
const axios = require("axios")
const express = require("express")
const cors = require("cors")
const fs = require("fs")

const app = express()

app.use(cors())
app.use(express.json())

mongoose.connect("mongodb://127.0.0.1:27017/osco")
.then(() => console.log("MongoDB подключен"))
.catch(err => console.log(err))

const Lead = mongoose.model("Lead",{
    name: String,
    phone: String,
    date: String
})

app.post("/send", async (req, res) => {

const { name, phone } = req.body

// 🔥 сохраняем в БД
const newLead = new Lead({
name,
phone,
date: new Date().toLocaleString()
})

await newLead.save()

console.log("Сохранено в Mongo:", name, phone)

// Telegram
const TOKEN = ""
const CHAT_ID = "5563420792"

const message = `Новая заявка:\nИмя: ${name}\nТелефон: ${phone}`

axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
chat_id: CHAT_ID,
text: message
})
.catch(err => console.error(err))

res.json({ status: "ok" })

})

app.listen(3000, () => {
console.log("Сервер работает: http://localhost:3000")
})

// admin panel
app.get("/admin", async (req, res) => {

const leads = await Lead.find().sort({ _id: -1 })

let rows = leads.map(l => `
<tr>
<td>${l.date}</td>
<td>${l.name}</td>
<td>${l.phone}</td>
</tr>
`).join("")

res.send(`
<html>
<body>
<h2>Заявки</h2>
<table border="1" cellpadding="10">
<tr>
<th>Дата</th>
<th>Имя</th>
<th>Телефон</th>
</tr>
${rows}
</table>
</body>
</html>
`)

})