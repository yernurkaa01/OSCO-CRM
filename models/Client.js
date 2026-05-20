import mongoose from "mongoose"

const clientSchema = new mongoose.Schema({

    name: String,

    phone: String,

    username: String,

    telegramId: String

})

export default mongoose.model("Client", clientSchema)