import type { FormattedDonation, Total } from '@gdq/types/tracker';
import { ChannelProps, registerChannel } from '../channels';
import { useEffect, useRef, useCallback } from 'react';

import { useListenFor, useReplicant } from 'use-nodecg';
import styled from '@emotion/styled';
import TweenNumber from '@gdq/lib/components/TweenNumber';

const CONFIG = {
	COLS: 182,
	ROWS: 55,
	WIDTH: 1092,
	HEIGHT: 332,

	GAME_SPEED: 100,
	PENDING_DURATION: 3000,
	INITIAL_TOTAL_DURATION: 4000,
	GRADIENT_ANIMATION_SPEED: 0.0005,

	COLORS: {
		DEAD: 'rgb(23, 1, 58)',
		DEAD_GRADIENT_END: 'rgb(10, 0, 30)',
		DEAD_GRADIENT_MID: 'rgb(40, 5, 80)',
		ALIVE: 'rgb(81, 0, 119)',
		PENDING: 'white',
		INITIAL: 'white',
		GRID: 'rgba(0, 0, 0, 0.3)',
	},
};

enum CellState {
	DEAD = 0,
	ALIVE = 1,
	PENDING = 2,
	INITIAL = 3,
}

type GridType = CellState[][];

interface PendingCell {
	row: number;
	col: number;
	timeout: NodeJS.Timeout;
}

registerChannel('Conways Game of Life', 13, ConwaysGameOfLife, {
	position: 'bottomLeft',
	site: 'Instagram',
	handle: 'Mikklosmanicker',
});

function ConwaysGameOfLife(_props: ChannelProps) {
	const [total] = useReplicant<Total | null>('total', null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const gridRef = useRef<GridType>(setupGrid());
	const pendingCellsRef = useRef<PendingCell[]>([]);
	const hasShownInitialTotal = useRef(false);
	const animationFrameRef = useRef<number | null>(null);
	const lastUpdateRef = useRef<number>(0);

	const cellWidth = CONFIG.WIDTH / CONFIG.COLS;
	const cellHeight = CONFIG.HEIGHT / CONFIG.ROWS;

	const drawGrid = useCallback(
		(timestamp: number) => {
			const canvas = canvasRef.current;
			const ctx = canvas?.getContext('2d');
			if (!ctx || !canvas) return;

			const grid = gridRef.current;

			const gradientPhase = (Math.sin(timestamp * CONFIG.GRADIENT_ANIMATION_SPEED) + 1) / 2;
			const gradient = ctx.createLinearGradient(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
			gradient.addColorStop(0, CONFIG.COLORS.DEAD);
			gradient.addColorStop(0.3 + gradientPhase * 0.4, CONFIG.COLORS.DEAD_GRADIENT_MID);
			gradient.addColorStop(1, CONFIG.COLORS.DEAD_GRADIENT_END);
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);

			for (let r = 0; r < CONFIG.ROWS; r++) {
				for (let c = 0; c < CONFIG.COLS; c++) {
					const state = grid[r][c];
					if (state !== CellState.DEAD) {
						switch (state) {
							case CellState.ALIVE:
								ctx.fillStyle = CONFIG.COLORS.ALIVE;
								break;
							case CellState.PENDING:
							case CellState.INITIAL:
								ctx.fillStyle = CONFIG.COLORS.PENDING;
								break;
						}
						ctx.fillRect(c * cellWidth, r * cellHeight, cellWidth - 0.5, cellHeight - 0.5);
					}
				}
			}

			ctx.strokeStyle = CONFIG.COLORS.GRID;
			ctx.lineWidth = 0.5;
			for (let r = 0; r <= CONFIG.ROWS; r++) {
				ctx.beginPath();
				ctx.moveTo(0, r * cellHeight);
				ctx.lineTo(CONFIG.WIDTH, r * cellHeight);
				ctx.stroke();
			}
			for (let c = 0; c <= CONFIG.COLS; c++) {
				ctx.beginPath();
				ctx.moveTo(c * cellWidth, 0);
				ctx.lineTo(c * cellWidth, CONFIG.HEIGHT);
				ctx.stroke();
			}
		},
		[cellWidth, cellHeight],
	);

	useEffect(() => {
		const gameLoop = (timestamp: number) => {
			if (timestamp - lastUpdateRef.current >= CONFIG.GAME_SPEED) {
				gridRef.current = updateGrid(gridRef.current);
				lastUpdateRef.current = timestamp;
			}
			drawGrid(timestamp);
			animationFrameRef.current = requestAnimationFrame(gameLoop);
		};

		animationFrameRef.current = requestAnimationFrame(gameLoop);

		return () => {
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
			}
		};
	}, [drawGrid]);

	useEffect(() => {
		if (total?.raw && !hasShownInitialTotal.current) {
			hasShownInitialTotal.current = true;
			const initialCells: PendingCell[] = [];
			setLargeDigitsAsInitial(gridRef.current, String(Math.floor(total.raw)), initialCells);

			initialCells.forEach((cell) => {
				const timeout = setTimeout(() => {
					if (gridRef.current[cell.row][cell.col] === CellState.INITIAL) {
						gridRef.current[cell.row][cell.col] = CellState.ALIVE;
					}
					pendingCellsRef.current = pendingCellsRef.current.filter(
						(c) => !(c.row === cell.row && c.col === cell.col),
					);
				}, CONFIG.INITIAL_TOTAL_DURATION);
				cell.timeout = timeout;
			});
			pendingCellsRef.current.push(...initialCells);
		}
	}, [total]);

	useListenFor('donation', (donation: FormattedDonation) => {
		const maxX = CONFIG.ROWS - 8;
		const maxY = CONFIG.COLS - (String(Math.floor(donation.rawAmount)).length * 4 + 8);

		const excludeBottomRows = 18;
		const excludeRightCols = 65;

		let startX: number;
		let startY: number;

		do {
			startX = Math.floor(Math.random() * Math.max(1, maxX));
			startY = Math.floor(Math.random() * Math.max(1, maxY));
		} while (startX > CONFIG.ROWS - excludeBottomRows && startY > CONFIG.COLS - excludeRightCols);

		const newPendingCells: PendingCell[] = [];
		setDigitAsPending(gridRef.current, String(Math.floor(donation.rawAmount)), startX, startY, newPendingCells);

		newPendingCells.forEach((cell) => {
			const timeout = setTimeout(() => {
				if (gridRef.current[cell.row][cell.col] === CellState.PENDING) {
					gridRef.current[cell.row][cell.col] = CellState.ALIVE;
				}
				pendingCellsRef.current = pendingCellsRef.current.filter(
					(c) => !(c.row === cell.row && c.col === cell.col),
				);
			}, CONFIG.PENDING_DURATION);
			cell.timeout = timeout;
		});
		pendingCellsRef.current.push(...newPendingCells);
	});

	return (
		<Container>
			<Canvas ref={canvasRef} width={CONFIG.WIDTH} height={CONFIG.HEIGHT} />
			<TotalEl>
				$<TweenNumber value={Math.floor(total?.raw ?? 0)} />
			</TotalEl>
		</Container>
	);
}

const Canvas = styled.canvas`
	position: absolute;
	width: ${CONFIG.WIDTH}px;
	height: ${CONFIG.HEIGHT}px;
`;

const Container = styled.div`
	position: absolute;
	background-color: rgb(0, 0, 0);
	width: ${CONFIG.WIDTH}px;
	height: ${CONFIG.HEIGHT}px;
	padding: 0;
	margin: 0;
`;

const TotalEl = styled.div`
	font-family: gdqpixel;
	font-size: 46px;
	color: #b62ff5ff;
	position: absolute;
	right: 1%;
	bottom: 5%;
	z-index: 1;
`;

function countLiveNeighbors(grid: GridType, row: number, col: number): number {
	let count = 0;
	for (let i = -1; i <= 1; i++) {
		for (let j = -1; j <= 1; j++) {
			if (i === 0 && j === 0) continue;
			const r = row + i;
			const c = col + j;
			if (r >= 0 && r < grid.length && c >= 0 && c < grid[0].length && grid[r][c] === CellState.ALIVE) {
				count++;
			}
		}
	}
	return count;
}

function updateGrid(grid: GridType): GridType {
	const newGrid = grid.map((row) => [...row]);

	for (let i = 0; i < grid.length; i++) {
		for (let j = 0; j < grid[i].length; j++) {
			if (grid[i][j] === CellState.PENDING || grid[i][j] === CellState.INITIAL) continue;

			const liveNeighbors = countLiveNeighbors(grid, i, j);

			if (grid[i][j] === CellState.ALIVE && (liveNeighbors < 2 || liveNeighbors > 3)) {
				newGrid[i][j] = CellState.DEAD;
			} else if (grid[i][j] === CellState.DEAD && liveNeighbors === 3) {
				newGrid[i][j] = CellState.ALIVE;
			}
		}
	}
	return newGrid;
}

function setupGrid(): GridType {
	return Array.from({ length: CONFIG.ROWS }, () => Array(CONFIG.COLS).fill(CellState.DEAD));
}

const digits: { [key: number]: number[][] } = {
	0: [
		[1, 1],
		[1, 2],
		[1, 3],
		[2, 1],
		[2, 3],
		[3, 1],
		[3, 3],
		[4, 1],
		[4, 3],
		[5, 1],
		[5, 2],
		[5, 3],
	],
	1: [
		[1, 1],
		[2, 1],
		[3, 1],
		[4, 1],
		[5, 1],
	],
	2: [
		[1, 1],
		[1, 2],
		[1, 3],
		[2, 3],
		[3, 1],
		[3, 2],
		[3, 3],
		[4, 1],
		[5, 1],
		[5, 2],
		[5, 3],
	],
	3: [
		[1, 1],
		[1, 2],
		[1, 3],
		[2, 3],
		[3, 1],
		[3, 2],
		[3, 3],
		[4, 3],
		[5, 1],
		[5, 2],
		[5, 3],
	],
	4: [
		[1, 1],
		[1, 3],
		[2, 1],
		[2, 3],
		[3, 1],
		[3, 2],
		[3, 3],
		[4, 3],
		[5, 3],
	],
	5: [
		[1, 1],
		[1, 2],
		[1, 3],
		[2, 1],
		[3, 1],
		[3, 2],
		[3, 3],
		[4, 3],
		[5, 1],
		[5, 2],
		[5, 3],
	],
	6: [
		[1, 1],
		[1, 2],
		[1, 3],
		[2, 1],
		[3, 1],
		[3, 2],
		[3, 3],
		[4, 1],
		[4, 3],
		[5, 1],
		[5, 2],
		[5, 3],
	],
	7: [
		[1, 1],
		[1, 2],
		[1, 3],
		[2, 3],
		[3, 3],
		[4, 3],
		[5, 3],
	],
	8: [
		[1, 1],
		[1, 2],
		[1, 3],
		[2, 1],
		[2, 3],
		[3, 1],
		[3, 2],
		[3, 3],
		[4, 1],
		[4, 3],
		[5, 1],
		[5, 2],
		[5, 3],
	],
	9: [
		[1, 1],
		[1, 2],
		[1, 3],
		[2, 1],
		[2, 3],
		[3, 1],
		[3, 2],
		[3, 3],
		[4, 3],
		[5, 3],
	],
};

const digitsWidths: { [key: number]: number } = {
	0: 3,
	1: 1,
	2: 3,
	3: 3,
	4: 3,
	5: 3,
	6: 3,
	7: 3,
	8: 3,
	9: 3,
};

const digitsLarge: { [key: number]: number[][] } = {
	0: [
		[1, 2],
		[1, 3],
		[1, 4],
		[1, 5],
		[1, 6],
		[1, 7],
		[1, 8],
		[2, 1],
		[2, 2],
		[2, 8],
		[2, 9],
		[3, 1],
		[3, 4],
		[3, 5],
		[3, 6],
		[3, 9],
		[3, 10],
		[4, 1],
		[4, 4],
		[4, 5],
		[4, 9],
		[4, 10],
		[5, 1],
		[5, 4],
		[5, 6],
		[5, 9],
		[5, 10],
		[6, 1],
		[6, 5],
		[6, 6],
		[6, 9],
		[6, 10],
		[7, 1],
		[7, 4],
		[7, 5],
		[7, 6],
		[7, 9],
		[7, 10],
		[8, 1],
		[8, 2],
		[8, 8],
		[8, 9],
		[8, 10],
		[9, 2],
		[9, 3],
		[9, 4],
		[9, 5],
		[9, 6],
		[9, 7],
		[9, 8],
		[9, 9],
		[9, 10],
		[10, 3],
		[10, 4],
		[10, 5],
		[10, 6],
		[10, 7],
		[10, 8],
		[10, 9],
	],
	1: [
		[1, 3],
		[1, 4],
		[1, 5],
		[1, 6],
		[2, 2],
		[2, 3],
		[2, 6],
		[2, 7],
		[3, 2],
		[3, 6],
		[3, 7],
		[4, 2],
		[4, 3],
		[4, 6],
		[4, 7],
		[5, 3],
		[5, 6],
		[5, 7],
		[6, 3],
		[6, 6],
		[6, 7],
		[7, 2],
		[7, 3],
		[7, 6],
		[7, 7],
		[8, 1],
		[8, 7],
		[9, 1],
		[9, 2],
		[9, 3],
		[9, 4],
		[9, 5],
		[9, 6],
		[9, 7],
		[10, 1],
		[10, 2],
		[10, 3],
		[10, 4],
		[10, 5],
		[10, 6],
		[10, 7],
	],
	2: [
		[1, 2],
		[1, 3],
		[1, 4],
		[1, 5],
		[1, 6],
		[1, 7],
		[1, 8],
		[2, 2],
		[2, 9],
		[3, 1],
		[3, 4],
		[3, 5],
		[3, 6],
		[3, 9],
		[4, 1],
		[4, 4],
		[4, 5],
		[4, 9],
		[5, 2],
		[5, 3],
		[5, 4],
		[5, 8],
		[5, 9],
		[6, 3],
		[6, 7],
		[6, 8],
		[7, 2],
		[7, 6],
		[7, 7],
		[7, 8],
		[7, 9],
		[8, 1],
		[8, 9],
		[9, 1],
		[9, 2],
		[9, 3],
		[9, 4],
		[9, 5],
		[9, 6],
		[9, 7],
		[9, 8],
		[9, 9],
		[10, 2],
		[10, 3],
		[10, 4],
		[10, 5],
		[10, 6],
		[10, 7],
		[10, 8],
	],
	3: [
		[1, 2],
		[1, 3],
		[1, 4],
		[1, 5],
		[1, 6],
		[1, 7],
		[1, 8],
		[2, 1],
		[2, 2],
		[2, 8],
		[2, 9],
		[3, 1],
		[3, 4],
		[3, 5],
		[3, 6],
		[3, 9],
		[4, 1],
		[4, 2],
		[4, 3],
		[4, 4],
		[4, 5],
		[4, 6],
		[4, 9],
		[5, 2],
		[5, 3],
		[5, 4],
		[5, 8],
		[5, 9],
		[6, 1],
		[6, 2],
		[6, 3],
		[6, 4],
		[6, 5],
		[6, 6],
		[6, 9],
		[7, 1],
		[7, 4],
		[7, 5],
		[7, 6],
		[7, 9],
		[8, 1],
		[8, 2],
		[8, 8],
		[8, 9],
		[9, 2],
		[9, 3],
		[9, 4],
		[9, 5],
		[9, 6],
		[9, 7],
		[9, 8],
		[9, 9],
		[10, 3],
		[10, 4],
		[10, 5],
		[10, 6],
		[10, 7],
		[10, 8],
	],
	4: [
		[1, 5],
		[1, 6],
		[1, 7],
		[1, 8],
		[2, 4],
		[2, 5],
		[2, 8],
		[2, 9],
		[3, 3],
		[3, 4],
		[3, 8],
		[3, 9],
		[4, 2],
		[4, 3],
		[4, 8],
		[4, 9],
		[5, 1],
		[5, 2],
		[5, 5],
		[5, 8],
		[5, 9],
		[6, 1],
		[6, 4],
		[6, 5],
		[6, 8],
		[6, 9],
		[7, 1],
		[7, 9],
		[7, 10],
		[8, 1],
		[8, 2],
		[8, 3],
		[8, 4],
		[8, 5],
		[8, 8],
		[8, 9],
		[8, 10],
		[9, 2],
		[9, 3],
		[9, 4],
		[9, 5],
		[9, 6],
		[9, 7],
		[9, 8],
		[9, 9],
		[9, 10],
		[10, 6],
		[10, 7],
		[10, 8],
		[10, 9],
	],
	5: [
		[1, 1],
		[1, 2],
		[1, 3],
		[1, 4],
		[1, 5],
		[1, 6],
		[1, 7],
		[1, 8],
		[1, 9],
		[1, 10],
		[2, 1],
		[2, 9],
		[2, 10],
		[3, 1],
		[3, 4],
		[3, 5],
		[3, 6],
		[3, 7],
		[3, 8],
		[3, 9],
		[3, 10],
		[4, 1],
		[4, 8],
		[4, 9],
		[4, 10],
		[5, 1],
		[5, 2],
		[5, 3],
		[5, 4],
		[5, 5],
		[5, 6],
		[5, 9],
		[5, 10],
		[6, 1],
		[6, 2],
		[6, 3],
		[6, 4],
		[6, 5],
		[6, 6],
		[6, 9],
		[6, 10],
		[7, 1],
		[7, 4],
		[7, 5],
		[7, 6],
		[7, 9],
		[7, 10],
		[8, 1],
		[8, 2],
		[8, 8],
		[8, 9],
		[8, 10],
		[9, 2],
		[9, 3],
		[9, 4],
		[9, 5],
		[9, 6],
		[9, 7],
		[9, 8],
		[9, 9],
		[9, 10],
		[10, 3],
		[10, 4],
		[10, 5],
		[10, 6],
		[10, 7],
		[10, 8],
		[10, 9],
	],
	6: [
		[1, 3],
		[1, 4],
		[1, 5],
		[1, 6],
		[1, 7],
		[2, 2],
		[2, 3],
		[2, 7],
		[2, 8],
		[3, 1],
		[3, 2],
		[3, 5],
		[3, 6],
		[3, 7],
		[3, 8],
		[4, 1],
		[4, 4],
		[4, 5],
		[4, 6],
		[4, 7],
		[4, 8],
		[5, 1],
		[5, 8],
		[5, 9],
		[6, 1],
		[6, 4],
		[6, 5],
		[6, 6],
		[6, 9],
		[6, 10],
		[7, 1],
		[7, 4],
		[7, 5],
		[7, 6],
		[7, 9],
		[7, 10],
		[8, 1],
		[8, 8],
		[8, 9],
		[8, 10],
		[9, 2],
		[9, 3],
		[9, 4],
		[9, 5],
		[9, 6],
		[9, 7],
		[9, 8],
		[9, 9],
		[9, 10],
		[10, 3],
		[10, 4],
		[10, 5],
		[10, 6],
		[10, 7],
		[10, 8],
		[10, 9],
	],
	7: [
		[1, 1],
		[1, 2],
		[1, 3],
		[1, 4],
		[1, 5],
		[1, 6],
		[1, 7],
		[1, 8],
		[1, 9],
		[2, 1],
		[2, 9],
		[2, 10],
		[3, 1],
		[3, 2],
		[3, 3],
		[3, 4],
		[3, 5],
		[3, 8],
		[3, 9],
		[3, 10],
		[4, 3],
		[4, 4],
		[4, 5],
		[4, 8],
		[4, 9],
		[4, 10],
		[5, 4],
		[5, 7],
		[5, 8],
		[5, 9],
		[6, 3],
		[6, 4],
		[6, 7],
		[6, 8],
		[6, 9],
		[7, 3],
		[7, 6],
		[7, 7],
		[7, 8],
		[8, 3],
		[8, 6],
		[8, 7],
		[8, 8],
		[9, 3],
		[9, 4],
		[9, 5],
		[9, 6],
		[9, 7],
		[10, 4],
		[10, 5],
		[10, 6],
		[10, 7],
	],
	8: [
		[1, 2],
		[1, 3],
		[1, 4],
		[1, 5],
		[1, 6],
		[1, 7],
		[1, 8],
		[2, 1],
		[2, 2],
		[2, 8],
		[2, 9],
		[3, 1],
		[3, 4],
		[3, 5],
		[3, 6],
		[3, 9],
		[3, 10],
		[4, 1],
		[4, 5],
		[4, 6],
		[4, 9],
		[4, 10],
		[5, 1],
		[5, 2],
		[5, 8],
		[5, 9],
		[5, 10],
		[6, 1],
		[6, 4],
		[6, 5],
		[6, 9],
		[6, 10],
		[7, 1],
		[7, 4],
		[7, 5],
		[7, 6],
		[7, 9],
		[7, 10],
		[8, 1],
		[8, 2],
		[8, 9],
		[8, 10],
		[9, 2],
		[9, 3],
		[9, 4],
		[9, 5],
		[9, 6],
		[9, 7],
		[9, 8],
		[9, 9],
		[9, 10],
		[10, 3],
		[10, 4],
		[10, 5],
		[10, 6],
		[10, 7],
		[10, 8],
		[10, 9],
	],
	9: [
		[1, 2],
		[1, 3],
		[1, 4],
		[1, 5],
		[1, 6],
		[1, 7],
		[1, 8],
		[2, 1],
		[2, 2],
		[2, 9],
		[3, 1],
		[3, 4],
		[3, 5],
		[3, 6],
		[3, 9],
		[3, 10],
		[4, 1],
		[4, 4],
		[4, 5],
		[4, 6],
		[4, 9],
		[4, 10],
		[5, 1],
		[5, 2],
		[5, 9],
		[5, 10],
		[6, 2],
		[6, 3],
		[6, 4],
		[6, 5],
		[6, 6],
		[6, 9],
		[6, 10],
		[7, 3],
		[7, 4],
		[7, 5],
		[7, 9],
		[7, 10],
		[8, 3],
		[8, 8],
		[8, 9],
		[8, 10],
		[9, 3],
		[9, 4],
		[9, 5],
		[9, 6],
		[9, 7],
		[9, 8],
		[9, 9],
		[10, 4],
		[10, 5],
		[10, 6],
		[10, 7],
		[10, 8],
	],
};

const digitsLargeWidths: { [key: number]: number } = {
	0: 7,
	1: 6,
	2: 7,
	3: 7,
	4: 7,
	5: 7,
	6: 7,
	7: 7,
	8: 7,
	9: 7,
};

const symbolsLargeWidth = 9;

const symbols: { [key: number]: number[][] } = {
	0: [
		[1, 2],
		[2, 1],
		[2, 2],
		[2, 3],
		[3, 1],
		[4, 1],
		[4, 2],
		[4, 3],
		[5, 3],
		[6, 1],
		[6, 2],
		[6, 3],
		[7, 2],
	],
};

const symbolsLarge: { [key: number]: number[][] } = {
	0: [
		[1, 4],
		[1, 5],
		[1, 6],
		[1, 7],
		[2, 3],
		[2, 4],
		[2, 7],
		[2, 8],
		[3, 2],
		[3, 9],
		[4, 2],
		[4, 9],
		[5, 2],
		[5, 4],
		[5, 5],
		[5, 6],
		[5, 7],
		[5, 8],
		[5, 9],
		[6, 2],
		[6, 9],
		[7, 2],
		[7, 9],
		[8, 2],
		[8, 3],
		[8, 4],
		[8, 5],
		[8, 6],
		[8, 7],
		[8, 9],
		[9, 2],
		[9, 9],
		[10, 2],
		[10, 9],
		[11, 3],
		[11, 4],
		[11, 7],
		[11, 8],
		[12, 4],
		[12, 5],
		[12, 6],
		[12, 7],
	],
};

const symbolsLargeHeight = 12;

function setDigitAsPending(
	grid: GridType,
	digit: string,
	startRow: number,
	startCol: number,
	pendingCells: PendingCell[],
) {
	let currentCol = startCol;

	for (const [row, col] of symbols[0]) {
		const cellRow = row + startRow - 1;
		const cellCol = col + currentCol;
		if (cellCol >= 0 && cellRow >= 0 && cellCol < grid[0].length && cellRow < grid.length) {
			grid[cellRow][cellCol] = CellState.PENDING;
			pendingCells.push({ row: cellRow, col: cellCol, timeout: null as any });
		}
	}

	currentCol += 4;

	for (let i = 0; i < digit.length; i++) {
		const currentDigit = Number(digit[i]);
		if (currentDigit in digits) {
			for (const [row, col] of digits[currentDigit]) {
				const cellRow = row + startRow;
				const cellCol = col + currentCol;
				if (cellCol >= 0 && cellRow >= 0 && cellCol < grid[0].length && cellRow < grid.length) {
					grid[cellRow][cellCol] = CellState.PENDING;
					pendingCells.push({ row: cellRow, col: cellCol, timeout: null as any });
				}
			}
		}
		currentCol += (digitsWidths[currentDigit] || 3) + 1;
	}
}

function setLargeDigitsAsInitial(grid: GridType, digit: string, pendingCells: PendingCell[]) {
	const digitSpacing = 1;
	const digitHeight = 12;
	const dollarDigitOffset = Math.floor((symbolsLargeHeight - digitHeight) / 2);

	let totalWidth = symbolsLargeWidth + digitSpacing;
	for (let i = 0; i < digit.length; i++) {
		const d = Number(digit[i]);
		totalWidth += (digitsLargeWidths[d] || 7) + digitSpacing;
	}
	totalWidth -= digitSpacing;

	const startRow = Math.floor((CONFIG.ROWS - symbolsLargeHeight) / 2);
	const startCol = Math.floor((CONFIG.COLS - totalWidth) / 2);

	let currentCol = startCol;

	for (const [row, col] of symbolsLarge[0]) {
		const cellRow = row + startRow - 2;
		const cellCol = col + currentCol;
		if (cellCol >= 0 && cellRow >= 0 && cellCol < grid[0].length && cellRow < grid.length) {
			grid[cellRow][cellCol] = CellState.INITIAL;
			pendingCells.push({ row: cellRow, col: cellCol, timeout: null as any });
		}
	}

	currentCol += symbolsLargeWidth + digitSpacing;

	for (let i = 0; i < digit.length; i++) {
		const currentDigit = Number(digit[i]);
		if (currentDigit in digitsLarge) {
			for (const [row, col] of digitsLarge[currentDigit]) {
				const cellRow = row + startRow - 1 + dollarDigitOffset;
				const cellCol = col + currentCol;
				if (cellCol >= 0 && cellRow >= 0 && cellCol < grid[0].length && cellRow < grid.length) {
					grid[cellRow][cellCol] = CellState.INITIAL;
					pendingCells.push({ row: cellRow, col: cellCol, timeout: null as any });
				}
			}
		}
		currentCol += (digitsLargeWidths[currentDigit] || 7) + digitSpacing;
	}
}
