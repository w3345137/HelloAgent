// core/message-bus.js
const EventEmitter = require('events');
class MessageBus extends EventEmitter {
    publish(topic, data) { this.emit(topic, data); }
    subscribe(topic, handler) { this.on(topic, handler); }
    unsubscribe(topic, handler) { this.removeListener(topic, handler); }
    once(topic, handler) { super.once(topic, handler); }
}
module.exports = new MessageBus();
