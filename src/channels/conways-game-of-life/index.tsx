import type   { FormattedDonation, Total } from '@gdq/types/tracker';
import  { ChannelProps, registerChannel } from '../channels';
import React from 'react';
import  { useState, useEffect, useRef } from 'react';

import  { useListenFor, useReplicant } from 'use-nodecg';
import styled from '@emotion/styled';
import TweenNumber from '@gdq/lib/components/TweenNumber';

// TODO!
// Fix so that when the game launches, it draws the current total donations sum with large digits at the middle of the grid in white for 1-2 seconds (adjustable in CONFIGURATION BLOCK) and then they are turned alive and the game starts.


// ============= CONFIGURATION VARIABLES =============
const CONFIG = {
	// Grid configuration - adjust these to change cell count and performance
	COLS: 182,  // Number of columns (width)
	ROWS: 55,   // Number of rows (height)

	// Game speed (milliseconds between updates)
	GAME_SPEED: 100,

	// Donation display configuration
	PENDING_DURATION: 3000,  // How long donation cells show in white before becoming alive (ms)
};

// Cell states
enum CellState {
	DEAD = 0,
	ALIVE = 1,
	PENDING = 2,  // Pending cells shown by donations
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

function ConwaysGameOfLife(props: ChannelProps)  {
	const  [total] = useReplicant<Total | null>('total', null);
	const  [grid, setGrid] = useState<GridType>(setupGrid);
	const pendingCellsRef = useRef<PendingCell[]>([]);

    const runGame = () => {
        setGrid((oldGrid) => updateGrid(oldGrid, pendingCellsRef.current));
     };

    useEffect(() => {
        const intervalId = setInterval(runGame, CONFIG.GAME_SPEED);

        return () => clearInterval(intervalId);
     }, []); // Remove grid dependency to avoid recreation

    useListenFor('donation', (donation: FormattedDonation) => {
		// Calculate random position
		const maxX = CONFIG.ROWS - 8;  // Leave room for digit height
		const maxY = CONFIG.COLS - (String(Math.floor(donation.rawAmount)).length * 4 + 8); // Leave room for $ + digits

		const startX = Math.floor(Math.random() * Math.max(1, maxX));
		const startY = Math.floor(Math.random() * Math.max(1, maxY));

		// Set cells to pending state
		setGrid((oldGrid) => {
			const newGrid = oldGrid.map(row => [...row]);  // Shallow copy of rows
			const newPendingCells: PendingCell[] = [];

			// Set digits as pending and track which cells
			setDigitAsPending(newGrid, String(Math.floor(donation.rawAmount)), startX, startY, newPendingCells);

			// Schedule cells to become alive after pending duration
			newPendingCells.forEach((cell) => {
				const timeout = setTimeout(() => {
					setGrid((grid) => {
						const updatedGrid = grid.map(row => [...row]);
						if (updatedGrid[cell.row][cell.col] === CellState.PENDING) {
							updatedGrid[cell.row][cell.col] = CellState.ALIVE;
						}
						return updatedGrid;
					});

					// Remove from pending cells list
					pendingCellsRef.current = pendingCellsRef.current.filter(
						(c) => !(c.row === cell.row && c.col === cell.col)
					);
				}, CONFIG.PENDING_DURATION);

				cell.timeout = timeout;
			});

			// Add to pending cells reference
			pendingCellsRef.current.push(...newPendingCells);

			return newGrid;
		});
	 });

	return (
		<Container>
            <TotalEl>
                $<TweenNumber value={Math.floor(total?.raw ?? 0)} />
            </TotalEl>
            {grid.map((row, i) =>
                <Row key={i}>
                    {row.map((cell, j) =>
                        <Cell key={j} cellState={cell}/>
                    )}
                </Row>)}
		</Container>
	);
}
const Row = styled.div`
    display: flex;
	flex: 1;
	width: 100%;
`;

const Cell = styled.div<{ cellState: CellState }>`
    flex: 1;
    border: 0.5px solid rgba(0, 0, 0, 0.3);
	aspect-ratio: 1;
    background-color: ${({ cellState }) => {
		if (cellState === CellState.PENDING) return 'white';  // Donation pending (white)
		if (cellState === CellState.ALIVE) return 'rgb(81, 0, 119)';  // Alive cells (purple)
		return 'rgb(6, 25, 67)';  // Dead cells (dark blue)
	}};
`;

const Container = styled.div`
    display: flex;
    flex-direction: column;
	position: absolute;
	background-color: rgb(0, 0, 0);
	width: 1092px;
	height: 332px;
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
`;

// Function to count the number of live neighbors for a given cell
function countLiveNeighbors(grid: GridType, row: number, col: number) {
    let count = 0;
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            if (i === 0 && j === 0) continue;  // Skip the cell itself

            let r = row + i, c = col + j;
            if(r >= 0 && r < grid.length && c >= 0 && c < grid[0].length && grid[r][c] === CellState.ALIVE) {
                count++;
             }
         }
     }
    return count;
}

// Function to update the state of the grid based on the Game of Life rules
function updateGrid(grid: GridType, pendingCells: PendingCell[]): GridType {
    const newGrid = grid.map(row => [...row]);  // Shallow copy

    for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[i].length; j++) {
			// Skip pending cells - they don't participate in the game yet
			if (grid[i][j] === CellState.PENDING) continue;

            let liveNeighbors = countLiveNeighbors(grid, i, j);

            // Apply the Game of Life rules
            if (grid[i][j] === CellState.ALIVE && (liveNeighbors < 2 || liveNeighbors > 3)) {
                newGrid[i][j] = CellState.DEAD;   // Die by under-population or overcrowding
             } else if (grid[i][j] === CellState.DEAD && liveNeighbors === 3) {
                newGrid[i][j] = CellState.ALIVE;   // Reproduce
             }
         }
     }

    return newGrid;
}

// Function to generate a new grid
const setupGrid = (): GridType => {
     // Create a new grid with the specified dimensions from CONFIG
    const newGrid = Array.from({ length: CONFIG.ROWS }, () =>
		Array(CONFIG.COLS).fill(CellState.DEAD)
	);

    console.log(`Created grid of size ${CONFIG.COLS}x${CONFIG.ROWS} (${CONFIG.COLS * CONFIG.ROWS} cells)`);

    return newGrid;
};

// Define the shapes for each digit from 0-9
const digits: { [key: number]: number[][] } = {
    0: [[1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3], [4, 1], [4, 3], [5, 1], [5, 2], [5, 3]],
    1: [[1, 2], [2, 2], [3, 2], [4, 2], [5, 2]],
    2: [[1, 1], [1, 2], [1, 3], [2, 3], [3, 1], [3, 2], [3, 3], [4, 1], [5, 1], [5, 2], [5, 3]],
    3: [[1, 1], [1, 2], [1, 3], [2, 3], [3, 1], [3, 2], [3, 3], [4, 3], [5, 1], [5, 2], [5, 3]],
    4: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2], [3, 3], [4, 3], [5, 3]],
    5: [[1, 1], [1, 2], [1, 3], [2, 1], [3, 1], [3, 2], [3, 3], [4, 3], [5, 1], [5, 2], [5, 3]],
    6: [[1, 1], [1, 2], [1, 3], [2, 1], [3, 1], [3, 2], [3, 3], [4, 1], [4, 3], [5, 1], [5, 2], [5, 3]],
    7: [[1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3]],
    8: [[1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2], [3, 3], [4, 1], [4, 3], [5, 1], [5, 2], [5, 3]],
    9: [[1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2], [3, 3], [4, 3], [5, 3]],
};

const symbols: { [key: number]: number[][] } = {
    0: [[1, 2], [2, 1], [2, 2], [2, 3], [3, 1], [4, 1], [4, 2], [4, 3], [5, 3], [6, 1], [6, 2], [6, 3], [7, 2]] //Dollar Sign
};

// Function to set a digit as pending cells in the grid (displayed before becoming alive)
function setDigitAsPending(
	grid: GridType,
	digit: string,
	startRow: number,
	startCol: number,
	pendingCells: PendingCell[]
) {
    let currentCol = startCol;

	// First, draw the dollar sign
    const dollarShape = symbols['0'];
    for (let [row, col] of dollarShape) {
        const cellRow = row + startRow - 1;
        const cellCol = col + currentCol;

        // Only set cells as pending when they are within the grid's boundaries
        if (cellCol >= 0 && cellRow >= 0 && cellCol < grid[0].length && cellRow < grid.length) {
			grid[cellRow][cellCol] = CellState.PENDING;
			pendingCells.push({ row: cellRow, col: cellCol, timeout: null as any });
        }
    }

	currentCol += 4;  // Space after dollar sign

	// Draw each digit
    for (let i = 0; i < digit.length; i++) {
        const currentDigit = Number(digit[i]);
        if (currentDigit in digits) {
            for (let [row, col] of digits[currentDigit]) {
                const cellRow = row + startRow;
                const cellCol = col + currentCol;

                // Only set cells as pending when they are within the grid's boundaries
                if (cellCol >= 0 && cellRow >= 0 && cellCol < grid[0].length && cellRow < grid.length) {
                    grid[cellRow][cellCol] = CellState.PENDING;
					pendingCells.push({ row: cellRow, col: cellCol, timeout: null as any });
                }
            }
        } else {
            console.log('Digit not recognized: ' + currentDigit);
        }

        currentCol += 4;  // Space between digits
    }
}