import mongoose from "mongoose"

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["owner", "cashier"], required: true },

    createdAt: {
        type: Date,
        default: Date.now
    }
})

export default mongoose.model("User", userSchema)