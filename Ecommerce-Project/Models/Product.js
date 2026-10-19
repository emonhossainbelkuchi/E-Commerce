const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String, default: '' },
  category: { 
    type: String, 
    enum: ['electronics', 'fashion', 'creative', 'beauty', 'home', 'sports', 'books', 'kids', 'pets', 'automotive', 'gifts'], 
    default: 'electronics' 
  },
  badge: { type: String, enum: ['new', 'sale', ''], default: '' },
  emoji: { type: String, default: '✦' },
  stock: { type: Number, default: 10 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', ProductSchema);