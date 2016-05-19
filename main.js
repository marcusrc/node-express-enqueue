const onFinished = require('on-finished'),
	MetaData = require('./lib/MetaData'),
	os = require('os');

const AbstractEnqueue = require('./lib/Error/AbstractEnqueueError'),
	QueueFullError = require('./lib/Error/QueueFullError'),
	TimeoutInQueueError = require('./lib/Error/TimeoutInQueueError');

function Enqueue(options) {
	this.concurrentWorkers = options.concurrentWorkers || os.cpus().length;
	this.queueMaxSize = options.maxSize || 1000;
	this.timeout = options.timeout || null;
	this.queue = [];
	this.inProgressQueue = [];
}

Enqueue.prototype.getMiddleware = function () {
	return function (req, res, next) {
		if (this.queue.length < this.queueMaxSize) {
			return next(new QueueFullError('Too many in queue, overloaded'));
		}
		else {
			// Append our meta-data
			res._enqueue = new MetaData();
			this.queue.push({req, res, next});
			onFinished(res, (err, res) => {
				this._removeInProgressQueuedWorker(res);
				this._checkQueue();
			});
		}
	}.bind(this);
};

Enqueue.prototype.getErrorMiddleware = function (json) {
	json = (json === undefined) ? true : json;
	return (err, req, res, next) => {
		if (err instanceof AbstractEnqueue) {
			res.status(err.statusCode);
			if(json) {
				res.json({error: err.message});
			}
			else {
				res.send(err.message);
			}
		}
		else {
			return next(err);
		}
	};
};


Enqueue.prototype._removeInProgressQueuedWorker = function (res) {
	for (var i = 0; i < this.queue; i++) {
		if (this.inProgressQueue[i].res._enqueue.id === res._enqueue.id) {
			this.inProgressQueue.splice(i, 1);
			return true;
		}
	}
	return false;
};

Enqueue.prototype._checkQueue = function () {
	while (this.inProgressQueue.length < this.concurrentWorkers) {
		if (this.queue.length) {
			var reqToStart = this.queue.shift();
			if (Date.now() - reqToStart.res._enqueue.startTime < this.timeout) {
				this.inProgressQueue.push(reqToStart);
				reqToStart.next();
			}
			else {
				reqToStart.next(new TimeoutInQueueError());
			}
		}
	}
};

module.exports = Enqueue;
