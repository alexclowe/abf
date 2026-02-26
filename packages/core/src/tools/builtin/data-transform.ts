/**
 * data-transform — in-memory data transformations on JSON arrays.
 * Supports filter, group_by, sort, limit, select, compute operations.
 * Pure JavaScript — no external dependencies.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

type Row = Record<string, unknown>;
type CompareOperator = 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'in';
type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

interface FilterOp {
	op: 'filter';
	field: string;
	operator: CompareOperator;
	value: unknown;
}

interface GroupByAgg {
	field: string;
	fn: AggFn;
	as: string;
}

interface GroupByOp {
	op: 'group_by';
	field: string;
	aggregations: GroupByAgg[];
}

interface SortOp {
	op: 'sort';
	field: string;
	order: 'asc' | 'desc';
}

interface LimitOp {
	op: 'limit';
	count: number;
}

interface SelectOp {
	op: 'select';
	fields: string[];
}

interface ComputeOp {
	op: 'compute';
	field: string;
	expression: 'pct_change' | 'rolling_avg' | 'rank';
	as: string;
	window?: number;
}

type Operation = FilterOp | GroupByOp | SortOp | LimitOp | SelectOp | ComputeOp;

function compare(rowVal: unknown, operator: CompareOperator, value: unknown): boolean {
	switch (operator) {
		case 'eq':
			return rowVal === value;
		case 'ne':
			return rowVal !== value;
		case 'gt':
			return typeof rowVal === 'number' && typeof value === 'number' && rowVal > value;
		case 'lt':
			return typeof rowVal === 'number' && typeof value === 'number' && rowVal < value;
		case 'gte':
			return typeof rowVal === 'number' && typeof value === 'number' && rowVal >= value;
		case 'lte':
			return typeof rowVal === 'number' && typeof value === 'number' && rowVal <= value;
		case 'contains':
			return (
				typeof rowVal === 'string' &&
				typeof value === 'string' &&
				rowVal.toLowerCase().includes(value.toLowerCase())
			);
		case 'in':
			return Array.isArray(value) && value.includes(rowVal);
	}
}

function applyFilter(data: Row[], op: FilterOp): Row[] {
	return data.filter(row => compare(row[op.field], op.operator, op.value));
}

function applyGroupBy(data: Row[], op: GroupByOp): Row[] {
	const groups = new Map<unknown, Row[]>();
	for (const row of data) {
		const key = row[op.field];
		const group = groups.get(key) ?? [];
		group.push(row);
		groups.set(key, group);
	}

	return [...groups.entries()].map(([key, rows]) => {
		const result: Row = { [op.field]: key };
		for (const agg of op.aggregations) {
			const values = rows.map(r => r[agg.field]).filter(v => typeof v === 'number') as number[];
			switch (agg.fn) {
				case 'count':
					result[agg.as] = rows.length;
					break;
				case 'sum':
					result[agg.as] = values.reduce((a, b) => a + b, 0);
					break;
				case 'avg':
					result[agg.as] =
						values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
					break;
				case 'min':
					result[agg.as] = values.length > 0 ? Math.min(...values) : null;
					break;
				case 'max':
					result[agg.as] = values.length > 0 ? Math.max(...values) : null;
					break;
			}
		}
		return result;
	});
}

function applySort(data: Row[], op: SortOp): Row[] {
	return [...data].sort((a, b) => {
		const av = a[op.field];
		const bv = b[op.field];
		if (typeof av === 'number' && typeof bv === 'number') {
			return op.order === 'asc' ? av - bv : bv - av;
		}
		const as = String(av ?? '');
		const bs = String(bv ?? '');
		return op.order === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
	});
}

function applySelect(data: Row[], op: SelectOp): Row[] {
	return data.map(row => {
		const result: Row = {};
		for (const field of op.fields) {
			result[field] = row[field];
		}
		return result;
	});
}

function applyCompute(data: Row[], op: ComputeOp): Row[] {
	const alias = op.as;

	if (op.expression === 'rank') {
		const sorted = [...data].sort((a, b) => {
			const av = a[op.field];
			const bv = b[op.field];
			if (typeof av === 'number' && typeof bv === 'number') return bv - av; // descending
			return 0;
		});
		const rankMap = new Map(sorted.map((row, i) => [row, i + 1]));
		return data.map(row => ({ ...row, [alias]: rankMap.get(row) ?? 0 }));
	}

	if (op.expression === 'pct_change') {
		return data.map((row, i) => {
			if (i === 0) return { ...row, [alias]: null };
			const prev = data[i - 1];
			const prevVal = prev ? prev[op.field] : undefined;
			const currVal = row[op.field];
			if (typeof prevVal === 'number' && typeof currVal === 'number' && prevVal !== 0) {
				return { ...row, [alias]: ((currVal - prevVal) / Math.abs(prevVal)) * 100 };
			}
			return { ...row, [alias]: null };
		});
	}

	if (op.expression === 'rolling_avg') {
		const window = op.window ?? 3;
		return data.map((row, i) => {
			const slice = data.slice(Math.max(0, i - window + 1), i + 1);
			const values = slice.map(r => r[op.field]).filter(v => typeof v === 'number') as number[];
			const avg =
				values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
			return { ...row, [alias]: avg };
		});
	}

	return data;
}

function applyOperation(data: Row[], op: Operation): Row[] {
	switch (op.op) {
		case 'filter':
			return applyFilter(data, op);
		case 'group_by':
			return applyGroupBy(data, op);
		case 'sort':
			return applySort(data, op);
		case 'limit':
			return data.slice(0, op.count);
		case 'select':
			return applySelect(data, op);
		case 'compute':
			return applyCompute(data, op);
	}
}

export function createDataTransformTool(_ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'data-transform' as ToolId,
		name: 'data-transform',
		description:
			'Perform computations on data: aggregate, group, sort, filter, compute statistics. ' +
			'Input is a JSON array of records. Operations: filter, group_by, sort, limit, select, compute.',
		source: 'registry',
		parameters: [
			{
				name: 'data',
				type: 'array',
				description: 'Array of JSON objects to transform (max 10,000 records)',
				required: true,
			},
			{
				name: 'operations',
				type: 'array',
				description:
					'Ordered list of operations to apply (filter, group_by, sort, limit, select, compute)',
				required: true,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 10_000,
	};

	return {
		definition,
		async execute(args) {
			const data = args['data'];
			if (!Array.isArray(data)) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'data-transform: data must be an array', {}),
				);
			}

			if (data.length > 10_000) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`data-transform: input exceeds 10,000 record limit (got ${data.length})`,
						{},
					),
				);
			}

			const ops = args['operations'];
			if (!Array.isArray(ops)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						'data-transform: operations must be an array',
						{},
					),
				);
			}

			let result = data as Row[];
			let operationsApplied = 0;

			for (const op of ops as unknown[]) {
				if (typeof op !== 'object' || op === null || !('op' in op)) {
					return Err(
						new ToolError(
							'TOOL_EXECUTION_FAILED',
							'data-transform: each operation must have an "op" field',
							{},
						),
					);
				}

				result = applyOperation(result, op as Operation);
				operationsApplied++;
			}

			return Ok({
				result,
				rowCount: result.length,
				operationsApplied,
			});
		},
	};
}
