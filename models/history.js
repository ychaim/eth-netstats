var _ = require('lodash');
var d3 = require('d3');

var MAX_HISTORY = 1000;

var MAX_PEER_PROPAGATION = 36;
var MIN_PROPAGATION_RANGE = 0;
var MAX_PROPAGATION_RANGE = 10000;

var MAX_UNCLES_PER_BIN = 25;
var MAX_BINS = 40;

var History = function History(data)
{
	this._items = [];

	var item = {
		height: 0,
		block: {
			number: 0,
			hash: '0x?',
			arrived: 0,
			received: 0,
			propagation: 0,
			difficulty: 0,
			gasUsed: 0,
			transactions: [],
			uncles: []
		},
		propagTimes: []
	};
}

History.prototype.add = function(block, id)
{
	if( !_.isUndefined(block) && !_.isUndefined(block.number) && !_.isUndefined(block.uncles) && !_.isUndefined(block.transactions) && !_.isUndefined(block.difficulty) && block.number > 0 )
	{
		var historyBlock = this.search(block.number);

		var now = _.now();
		block.arrived = now;
		block.received = now;
		block.propagation = 0;

		if( historyBlock )
		{
			var propIndex = _.findIndex( historyBlock.propagTimes, { node: id } );

			if( propIndex === -1 )
			{
				block.arrived = historyBlock.block.arrived;
				block.received = now;
				block.propagation = now - historyBlock.block.received;

				historyBlock.propagTimes.push({
					node: id,
					received: now,
					propagation: block.propagation
				});
			}
			else
			{
				block.arrived = historyBlock.block.arrived;
				block.received = historyBlock.propagTimes[propIndex].received;
				block.propagation = historyBlock.propagTimes[propIndex].propagation;
			}
		}
		else
		{
			var prevBlock = this.prevMaxBlock(block.number);

			if( prevBlock )
			{
				block.time = Math.max(block.arrived - prevBlock.block.arrived, 0);

				if(block.number < this.bestBlock().height)
					block.time = Math.max((block.timestamp - prevBlock.block.timestamp) * 1000, 0);
			}
			else
			{
				block.time = 0;
			}

			var item = {
				height: block.number,
				block: block,
				propagTimes: []
			}

			if( this._items.length === 0 || block.number >= (this.bestBlockNumber() - MAX_HISTORY + 1) )
			{
				item.propagTimes.push({
					node: id,
					received: now,
					propagation: block.propagation
				});

				this._save(item);
			}
		}

		return block;
	}

	return false;
}

History.prototype._save = function(block)
{
	this._items.unshift(block);

	if(this._items.length > MAX_HISTORY)
	{
		this._items.pop();
	}

	this._items = _.sortByOrder( this._items, 'height', false );
}

History.prototype.search = function(number)
{
	var index = _.findIndex( this._items, { height: number } );

	if(index < 0)
		return false;

	return this._items[index];
}

History.prototype.prevMaxBlock = function(number)
{
	var index = _.findIndex(this._items, function (item) {
		return item.height < number;
	});

	if(index < 0)
		return false;

	return this._items[index];
}

History.prototype.bestBlock = function()
{
	return _.max(this._items, 'height');
}

History.prototype.bestBlockNumber = function()
{
	var best = this.bestBlock();

	if( !_.isUndefined(best.height) )
		return best.height;

	return 0;
}

History.prototype.getNodePropagation = function(id)
{
	var propagation = new Array( MAX_PEER_PROPAGATION );
	var bestBlock = this.bestBlockNumber();

	_.fill(propagation, -1);

	var sorted = _( this._items )
		.sortByOrder( 'height', false )
		.slice( 0, MAX_PEER_PROPAGATION )
		.reverse()
		.forEach(function (item, key)
		{
			var index = MAX_PEER_PROPAGATION - 1 - bestBlock + item.height;

			if(index > 0)
			{
				propagation[index] = _.result(_.find(item.propagTimes, 'node', id), 'propagation', -1);
			}
		})
		.value();

	return propagation;
}

History.prototype.getBlockPropagation = function()
{
	var propagation = [];
	var avgPropagation = 0;

	_.forEach(this._items, function (n, key)
	{
		_.forEach(n.propagTimes, function (p, i)
		{
			var prop = Math.min(MAX_PROPAGATION_RANGE, _.result(p, 'propagation', -1));

			if(prop >= 0)
				propagation.push(prop);
		});
	});

	if(propagation.length > 0)
	{
		var avgPropagation = Math.round( _.sum(propagation) / propagation.length );
	}

	var data = d3.layout.histogram()
		.frequency( false )
		.range([ MIN_PROPAGATION_RANGE, MAX_PROPAGATION_RANGE ])
		.bins( MAX_BINS )
		( propagation );

	var freqCum = 0;
	var histogram = data.map(function (val) {
		freqCum += val.length;
		var cumPercent = ( freqCum / Math.max(1, propagation.length) );

		return {
			x: val.x,
			dx: val.dx,
			y: val.y,
			frequency: val.length,
			cumulative: freqCum,
			cumpercent: cumPercent
		};
	});

	return {
		histogram: histogram,
		avg: avgPropagation
	};
}

History.prototype.getUncleCount = function()
{
	var uncles = _( this._items )
		.sortByOrder( 'height', false )
		.map(function (item)
		{
			return item.block.uncles.length;
		})
		.value();

	var uncleBins = _.fill( Array(MAX_BINS), 0 );

	var sumMapper = function (array, key)
	{
		uncleBins[key] = _.sum(array);
		return _.sum(array);
	};

	_.map(_.chunk( uncles, MAX_UNCLES_PER_BIN ), sumMapper);

	return uncleBins;
}

History.prototype.getBlockTimes = function()
{
	var blockTimes = _( this._items )
		.sortByOrder( 'height', false )
		.slice(0, MAX_BINS)
		.reverse()
		.map(function (item)
		{
			return item.block.time;
		})
		.value();

	return blockTimes;
}

History.prototype.getDifficulty = function()
{
	var difficultyHistory = _( this._items )
		.sortByOrder( 'height', false )
		.slice(0, MAX_BINS)
		.reverse()
		.map(function (item)
		{
			return item.block.difficulty;
		})
		.value();

	return difficultyHistory;
}

History.prototype.getTransactionsCount = function()
{
	var txCount = _( this._items )
		.sortByOrder( 'height', false )
		.slice(0, MAX_BINS)
		.reverse()
		.map(function (item)
		{
			return item.block.transactions.length;
		})
		.value();

	return txCount;
}

History.prototype.getGasSpending = function()
{
	var gasSpending = _( this._items )
		.sortByOrder( 'height', false )
		.slice(0, MAX_BINS)
		.reverse()
		.map(function (item)
		{
			return item.block.gasUsed;
		})
		.value();

	return gasSpending;
}

History.prototype.getAvgHashrate = function()
{
	if( _.isEmpty(this._items) )
		return 0;

	var blocktimeHistory = _( this._items )
		.sortByOrder( 'height', false )
		.slice(0, 64)
		.map(function (item)
		{
			return item.block.time;
		})
		.value();

	var avgBlocktime = (_.sum(blocktimeHistory) / blocktimeHistory.length)/1000;

	return this.bestBlock().block.difficulty / avgBlocktime;
}

History.prototype.getMinersCount = function()
{
	var miners = _( this._items )
		.sortByOrder( 'height', false )
		.slice(0, MAX_BINS)
		.map(function (item)
		{
			return item.block.miner;
		})
		.value();

	var minerCount = [];

	_.forEach( _.countBy(miners), function (cnt, miner)
	{
		minerCount.push({ miner: miner, name: false, blocks: cnt });
	});

	return _(minerCount)
		.sortByOrder( 'blocks', false )
		.slice(0, 5)
		.value();
}

History.prototype.getCharts = function()
{
	var chartHistory = _( this._items )
		.sortByOrder( 'height', false )
		.slice(0, MAX_BINS)
		.reverse()
		.map(function (item)
		{
			return {
				height: item.height,
				blocktime: item.block.time / 1000,
				difficulty: item.block.difficulty,
				uncles: item.block.uncles.length,
				transactions: item.block.transactions.length,
				gasSpending: item.block.gasUsed,
				miner: item.block.miner
			};
		})
		.value();

	return {
		height : _.pluck( chartHistory, 'height' ),
		blocktime : _.pluck( chartHistory, 'blocktime' ),
		avgBlocktime : _.sum(_.pluck( chartHistory, 'blocktime' )) / (chartHistory.length === 0 ? 1 : chartHistory.length),
		difficulty : _.pluck( chartHistory, 'difficulty' ),
		uncles : _.pluck( chartHistory, 'uncles' ),
		transactions : _.pluck( chartHistory, 'transactions' ),
		gasSpending : _.pluck( chartHistory, 'gasSpending' ),
		miners : this.getMinersCount(),
		propagation : this.getBlockPropagation(),
		uncleCount : this.getUncleCount(),
		avgHashrate : this.getAvgHashrate()
	};
}

History.prototype.requiresUpdate = function()
{
	return ( this._items.length < MAX_HISTORY && !_.isEmpty(this._items) );
}

History.prototype.getHistoryRequestRange = function()
{
	if( _.isEmpty(this._items) )
		return false;

	var blocks = _.pluck( this._items, 'height' );
	var best = _.max( blocks );
	var range = _.range( _.max([ 0, best - MAX_HISTORY ]), best + 1);

	var missing = _.difference( range, blocks );

	var max = _.max(missing);
	var min = max - Math.min( 50, (MAX_HISTORY - this._items.length + 1) ) + 1;

	return {
		max: max,
		min: min,
		list: _( missing ).reverse().slice(0, 50).reverse().value()
	};
}

module.exports = History;
