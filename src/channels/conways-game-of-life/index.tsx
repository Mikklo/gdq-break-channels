import type { FormattedDonation, Total } from '@gdq/types/tracker';
import { ChannelProps, registerChannel } from '../channels';
import { useEffect, useRef, useCallback } from 'react';

import { useListenFor, useReplicant } from 'use-nodecg';
import styled from '@emotion/styled';

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
		IMMUNE: 'rgb(182, 47, 245)',
		GRID: 'rgba(0, 0, 0, 0.3)',
	},
};

enum CellState {
	DEAD = 0,
	ALIVE = 1,
	PENDING = 2,
	INITIAL = 3,
	IMMUNE = 4,
}

type GridType = CellState[][];

interface PendingCell {
	row: number;
	col: number;
	timeout: NodeJS.Timeout;
}

interface ImmuneCell {
	row: number;
	col: number;
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
	const immuneCellsRef = useRef<ImmuneCell[]>([]);
	const lastDisplayedTotal = useRef<number>(-1);
	const targetTotal = useRef<number>(0);
	const tweenIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
							case CellState.IMMUNE:
								ctx.fillStyle = CONFIG.COLORS.IMMUNE;
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

	// Update immune cells when total changes with count-up animation
	useEffect(() => {
		const newTotal = Math.floor(total?.raw ?? 0);

		if (newTotal !== targetTotal.current) {
			targetTotal.current = newTotal;

			// Clear any existing animation
			if (tweenIntervalRef.current) {
				clearInterval(tweenIntervalRef.current);
			}

			// If this is the first time (displayed is -1), just set it directly
			if (lastDisplayedTotal.current === -1) {
				lastDisplayedTotal.current = newTotal;
				immuneCellsRef.current = setTotalAsImmune(gridRef.current, newTotal, immuneCellsRef.current);
				return;
			}

			const startValue = lastDisplayedTotal.current;
			const endValue = newTotal;
			const difference = endValue - startValue;
			const duration = Math.min(2000, Math.max(500, Math.abs(difference) * 2)); // 500ms to 2s based on difference
			const steps = Math.min(60, Math.abs(difference)); // Max 60 steps
			const stepDuration = duration / steps;
			let currentStep = 0;

			tweenIntervalRef.current = setInterval(() => {
				currentStep++;
				const progress = currentStep / steps;
				// Ease out cubic for smooth deceleration
				const easedProgress = 1 - Math.pow(1 - progress, 3);
				const displayValue = Math.floor(startValue + difference * easedProgress);

				if (displayValue !== lastDisplayedTotal.current) {
					lastDisplayedTotal.current = displayValue;
					immuneCellsRef.current = setTotalAsImmune(gridRef.current, displayValue, immuneCellsRef.current);
				}

				if (currentStep >= steps) {
					// Ensure we end on the exact target
					lastDisplayedTotal.current = endValue;
					immuneCellsRef.current = setTotalAsImmune(gridRef.current, endValue, immuneCellsRef.current);
					if (tweenIntervalRef.current) {
						clearInterval(tweenIntervalRef.current);
						tweenIntervalRef.current = null;
					}
				}
			}, stepDuration);
		}

		return () => {
			if (tweenIntervalRef.current) {
				clearInterval(tweenIntervalRef.current);
			}
		};
	}, [total]);

	useListenFor('donation', (donation: FormattedDonation) => {
		const maxX = CONFIG.ROWS - 8;
		const maxY = CONFIG.COLS - (String(Math.floor(donation.rawAmount)).length * 4 + 8);

		// Check if a donation position would overlap with immune cells
		const wouldOverlapImmune = (testStartX: number, testStartY: number): boolean => {
			const immuneSet = new Set(immuneCellsRef.current.map((c) => `${c.row},${c.col}`));
			const donationStr = String(Math.floor(donation.rawAmount));

			// Check dollar sign cells
			for (const [row, col] of symbols[0]) {
				const cellRow = row + testStartX - 1;
				const cellCol = col + testStartY;
				if (immuneSet.has(`${cellRow},${cellCol}`)) return true;
			}

			// Check digit cells
			let currentCol = testStartY + 4;
			for (let i = 0; i < donationStr.length; i++) {
				const currentDigit = Number(donationStr[i]);
				if (currentDigit in digits) {
					for (const [row, col] of digits[currentDigit]) {
						const cellRow = row + testStartX;
						const cellCol = col + currentCol;
						if (immuneSet.has(`${cellRow},${cellCol}`)) return true;
					}
				}
				currentCol += (digitsWidths[currentDigit] || 3) + 1;
			}
			return false;
		};

		let startX: number;
		let startY: number;
		let attempts = 0;
		const maxAttempts = 50;

		do {
			startX = Math.floor(Math.random() * Math.max(1, maxX));
			startY = Math.floor(Math.random() * Math.max(1, maxY));
			attempts++;
		} while (wouldOverlapImmune(startX, startY) && attempts < maxAttempts);

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
			if (
				grid[i][j] === CellState.PENDING ||
				grid[i][j] === CellState.INITIAL ||
				grid[i][j] === CellState.IMMUNE
			)
				continue;

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

// Doubled digits (each pixel becomes 2x2)
function createDoubledDigits(): { [key: number]: number[][] } {
	const doubled: { [key: number]: number[][] } = {};
	for (const [digit, coords] of Object.entries(digits)) {
		doubled[Number(digit)] = coords.flatMap(([row, col]) => [
			[row * 2 - 1, col * 2 - 1],
			[row * 2 - 1, col * 2],
			[row * 2, col * 2 - 1],
			[row * 2, col * 2],
		]);
	}
	return doubled;
}

const digitsDoubled = createDoubledDigits();

const digitsDoubledWidths: { [key: number]: number } = {
	0: 6,
	1: 2,
	2: 6,
	3: 6,
	4: 6,
	5: 6,
	6: 6,
	7: 6,
	8: 6,
	9: 6,
};

// Doubled dollar sign (original is in symbols[0])
function createDoubledSymbol(): number[][] {
	return symbols[0].flatMap(([row, col]) => [
		[row * 2 - 1, col * 2 - 1],
		[row * 2 - 1, col * 2],
		[row * 2, col * 2 - 1],
		[row * 2, col * 2],
	]);
}

const symbolDoubled = createDoubledSymbol();
const symbolDoubledWidth = 6;

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

function setTotalAsImmune(grid: GridType, total: number, previousImmuneCells: ImmuneCell[]): ImmuneCell[] {
	// Clear previous immune cells
	for (const cell of previousImmuneCells) {
		if (cell.row >= 0 && cell.row < grid.length && cell.col >= 0 && cell.col < grid[0].length) {
			grid[cell.row][cell.col] = CellState.DEAD;
		}
	}

	const newImmuneCells: ImmuneCell[] = [];
	const digit = String(Math.floor(total));
	const digitSpacing = 1;
	const dollarSignHeight = 14; // doubled from 7 (original symbols[0] is 7 rows)
	const digitHeight = 10; // doubled from 5
	const totalHeight = Math.max(dollarSignHeight, digitHeight);

	// Calculate total width
	let totalWidth = symbolDoubledWidth + digitSpacing;
	for (let i = 0; i < digit.length; i++) {
		const d = Number(digit[i]);
		totalWidth += (digitsDoubledWidths[d] || 6) + digitSpacing;
	}
	totalWidth -= digitSpacing;

	// Position in bottom-right corner with some padding
	const paddingRight = 1;
	const paddingBottom = 1;
	const startRow = CONFIG.ROWS - totalHeight - paddingBottom;
	const startCol = CONFIG.COLS - totalWidth - paddingRight;

	let currentCol = startCol;

	// Draw dollar sign
	for (const [row, col] of symbolDoubled) {
		const cellRow = row + startRow - 1;
		const cellCol = col + currentCol - 1;
		if (cellCol >= 0 && cellRow >= 0 && cellCol < grid[0].length && cellRow < grid.length) {
			grid[cellRow][cellCol] = CellState.IMMUNE;
			newImmuneCells.push({ row: cellRow, col: cellCol });
		}
	}

	currentCol += symbolDoubledWidth + digitSpacing;

	// Draw digits (vertically centered relative to dollar sign)
	const digitVerticalOffset = Math.floor((dollarSignHeight - digitHeight) / 2);
	for (let i = 0; i < digit.length; i++) {
		const currentDigit = Number(digit[i]);
		if (currentDigit in digitsDoubled) {
			for (const [row, col] of digitsDoubled[currentDigit]) {
				const cellRow = row + startRow - 1 + digitVerticalOffset;
				const cellCol = col + currentCol - 1;
				if (cellCol >= 0 && cellRow >= 0 && cellCol < grid[0].length && cellRow < grid.length) {
					grid[cellRow][cellCol] = CellState.IMMUNE;
					newImmuneCells.push({ row: cellRow, col: cellCol });
				}
			}
		}
		currentCol += (digitsDoubledWidths[currentDigit] || 6) + digitSpacing;
	}

	return newImmuneCells;
}
