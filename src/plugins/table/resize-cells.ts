/*!
 * Jodit Editor (https://xdsoft.net/jodit/)
 * Released under MIT see LICENSE.txt in the project root for license information.
 * Copyright (c) 2013-2020 Valeriy Chupurnov. All rights reserved. https://xdsoft.net
 */
import './table.less';

import autobind from 'autobind-decorator';

import * as consts from '../../core/constants';
import { Plugin, Dom, Table } from '../../modules';
import {
	$$,
	call,
	dataBind,
	getContentWidth,
	offset
} from '../../core/helpers';
import { IBound, IJodit } from '../../types';

const key = 'table_processor_observer-resize';

/**
 * Process tables in editor
 */
export class resizeCells extends Plugin {
	/**
	 * Shortcut for Table module
	 */
	private get module(): Table {
		return this.j.getInstance<Table>('Table', this.j.o);
	}

	/**
	 * Now editor has rtl direction
	 */
	private get isRTL(): boolean {
		return this.j.o.direction === 'rtl';
	}

	private selectMode: boolean = false;

	private resizeDelta: number = 0;
	private resizeHandler!: HTMLElement;

	private showResizeHandle() {
		this.j.async.clearTimeout(this.hideTimeout);
		this.j.workplace.appendChild(this.resizeHandler);
	}

	private hideResizeHandle() {
		this.hideTimeout = this.j.async.setTimeout(
			() => {
				Dom.safeRemove(this.resizeHandler);
			},
			{
				timeout: this.j.defaultTimeout,
				label: 'hideResizer'
			}
		);
	}

	private createResizeHandle = () => {
		if (!this.resizeHandler) {
			this.resizeHandler = this.j.c.div('jodit-table-resizer');

			this.j.e
				.on(
					this.resizeHandler,
					'mousedown.table touchstart.table',
					this.onHandleMouseDown.bind(this)
				)
				.on(this.resizeHandler, 'mouseenter.table', () => {
					this.j.async.clearTimeout(this.hideTimeout);
				});
		}
	};

	private hideTimeout: number = 0;

	private drag: boolean = false;

	private wholeTable!: boolean | null;
	private workCell!: HTMLTableCellElement;
	private workTable!: HTMLTableElement;

	private minX: number = 0;
	private maxX: number = 0;

	private startX: number = 0;

	private onHandleMouseDown(event: MouseEvent) {
		this.drag = true;

		this.j.e.on(
			this.j.editorWindow,
			'mousemove.table touchmove.table',
			this.onMouseMove
		);

		this.startX = event.clientX;

		this.j.lock(key);
		this.resizeHandler.classList.add('jodit-table-resizer-moved');

		let box: ClientRect,
			tableBox = this.workTable.getBoundingClientRect();

		this.minX = 0;
		this.maxX = 1000000;

		if (this.wholeTable !== null) {
			tableBox = (this.workTable
				.parentNode as HTMLElement).getBoundingClientRect();

			this.minX = tableBox.left;
			this.maxX = this.minX + tableBox.width;
		} else {
			// find maximum columns
			const coordinate = Table.formalCoordinate(
				this.workTable,
				this.workCell,
				true
			);

			Table.formalMatrix(this.workTable, (td, i, j) => {
				if (coordinate[1] === j) {
					box = td.getBoundingClientRect();

					this.minX = Math.max(
						box.left + consts.NEARBY / 2,
						this.minX
					);
				}

				if (coordinate[1] + (this.isRTL ? -1 : 1) === j) {
					box = td.getBoundingClientRect();

					this.maxX = Math.min(
						box.left + box.width - consts.NEARBY / 2,
						this.maxX
					);
				}
			});
		}

		return false;
	}

	@autobind
	private onMouseMove(event: MouseEvent) {
		if (!this.drag) {
			return;
		}

		let x = event.clientX;

		const workplacePosition: IBound = offset(
			(this.resizeHandler.parentNode ||
				this.j.od.documentElement) as HTMLElement,
			this.j,
			this.j.od,
			true
		);

		if (x < this.minX) {
			x = this.minX;
		}

		if (x > this.maxX) {
			x = this.maxX;
		}

		this.resizeDelta =
			x - this.startX + (!this.j.o.iframe ? 0 : workplacePosition.left);

		this.resizeHandler.style.left =
			x - (this.j.o.iframe ? 0 : workplacePosition.left) + 'px';

		const sel = this.j.selection.sel;

		sel && sel.removeAllRanges();

		if (event.preventDefault) {
			event.preventDefault();
		}
	}

	private onMouseUp = () => {
		if (this.selectMode || this.drag) {
			this.selectMode = false;
			this.j.unlock();
		}

		if (!this.resizeHandler || !this.drag) {
			return;
		}

		this.drag = false;

		this.j.e.off(
			this.j.editorWindow,
			'mousemove.table touchmove.table',
			this.onMouseMove
		);

		this.resizeHandler.classList.remove('jodit-table-resizer-moved');

		// resize column
		if (this.wholeTable === null) {
			this.resizeColumns();
		} else {
			this.resizeTable();
		}

		this.j.setEditorValue();
		this.j.selection.focus();
	};

	private resizeColumns() {
		const delta = this.resizeDelta;

		const marked: HTMLTableCellElement[] = [];

		Table.setColumnWidthByDelta(
			this.workTable,
			Table.formalCoordinate(this.workTable, this.workCell, true)[1],
			delta,
			true,
			marked
		);

		const nextTD = call(
			this.isRTL ? Dom.prev : Dom.next,
			this.workCell,
			elm => Dom.isCell(elm, this.j.editorWindow),
			this.workCell.parentNode as HTMLElement
		) as HTMLTableCellElement;

		Table.setColumnWidthByDelta(
			this.workTable,
			Table.formalCoordinate(this.workTable, nextTD)[1],
			-delta,
			false,
			marked
		);
	}

	private resizeTable() {
		const delta = this.resizeDelta * (this.isRTL ? -1 : 1);

		const width = this.workTable.offsetWidth,
			parentWidth = getContentWidth(
				this.workTable.parentNode as HTMLElement,
				this.j.editorWindow
			);

		// for RTL use mirror logic
		const rightSide = !this.wholeTable;
		const needChangeWidth = this.isRTL ? !rightSide : rightSide;

		// right side
		if (needChangeWidth) {
			this.workTable.style.width =
				((width + delta) / parentWidth) * 100 + '%';
		} else {
			const side = this.isRTL ? 'marginRight' : 'marginLeft';

			const margin = parseInt(
				this.j.editorWindow.getComputedStyle(this.workTable)[side] ||
					'0',
				10
			);

			this.workTable.style.width =
				((width - delta) / parentWidth) * 100 + '%';

			this.workTable.style[side] =
				((margin + delta) / parentWidth) * 100 + '%';
		}
	}

	/**
	 *
	 * @param {HTMLTableCellElement} cell
	 * @param {boolean|null} [wholeTable=null] true - resize whole table by left side,
	 * false - resize whole table by right side, null - resize column
	 * @private
	 */
	private setWorkCell(
		cell: HTMLTableCellElement,
		wholeTable: boolean | null = null
	) {
		this.wholeTable = wholeTable;

		this.workCell = cell;

		this.workTable = Dom.up(
			cell,
			(elm: Node | null) => Dom.isTag(elm, 'table'),
			this.j.editor
		) as HTMLTableElement;
	}

	/**
	 * Calc helper resize handle position
	 *
	 * @param {HTMLTableElement} table
	 * @param {HTMLTableCellElement} cell
	 * @param {int} [offsetX=0]
	 * @param {int} [delta=0]
	 *
	 * @private
	 */
	private calcHandlePosition(
		table: HTMLTableElement,
		cell: HTMLTableCellElement,
		offsetX: number = 0,
		delta: number = 0
	) {
		const box = offset(cell, this.j, this.j.editorDocument);

		if (offsetX > consts.NEARBY && offsetX < box.width - consts.NEARBY) {
			this.hideResizeHandle();
			return;
		}

		const workplacePosition: IBound = offset(
				this.j.workplace,
				this.j,
				this.j.od,
				true
			),
			parentBox: IBound = offset(table, this.j, this.j.editorDocument);

		this.resizeHandler.style.left =
			(offsetX <= consts.NEARBY ? box.left : box.left + box.width) -
			workplacePosition.left +
			delta +
			'px';

		Object.assign(this.resizeHandler.style, {
			height: parentBox.height + 'px',
			top: parentBox.top - workplacePosition.top + 'px'
		});

		this.showResizeHandle();

		if (offsetX <= consts.NEARBY) {
			const prevTD = call(
				this.isRTL ? Dom.next : Dom.prev,
				cell,
				elm => Dom.isCell(elm, this.j.editorWindow),
				cell.parentNode as HTMLElement
			) as HTMLTableCellElement;

			if (prevTD) {
				this.setWorkCell(prevTD);
			} else {
				this.setWorkCell(cell, true);
			}
		} else {
			const nextTD = call(
				!this.isRTL ? Dom.next : Dom.prev,
				cell,
				elm => Dom.isCell(elm, this.j.editorWindow),
				cell.parentNode as HTMLElement
			);

			this.setWorkCell(cell, !nextTD ? false : null);
		}
	}

	/**
	 *
	 * @param {Jodit} editor
	 */
	afterInit(editor: IJodit): void {
		if (!editor.o.table.allowCellResize) {
			return;
		}

		editor.e
			.off(this.j.ow, '.resize-cells')
			.off('.resize-cells')
			.on('change.resize-cells afterCommand.resize-cells afterSetMode.resize-cells', () => {
				($$(
					'table',
					editor.editor
				) as HTMLTableElement[]).forEach(this.observe);
			})
			.on(this.j.ow, 'mouseup.resize-cells touchend.resize-cells', this.onMouseUp)
			.on(this.j.ow, 'scroll.resize-cells', () => {
				if (this.drag) {
					const parent = Dom.up(
						this.workCell,
						(elm: Node | null) => Dom.isTag(elm, 'table'),
						editor.editor
					) as HTMLElement;

					if (parent) {
						const parentBox = parent.getBoundingClientRect();
						this.resizeHandler.style.top = parentBox.top + 'px';
					}
				}
			})
			.on('beforeSetMode.resize-cells', () => {
				this.module.getAllSelectedCells().forEach(td => {
					this.module.removeSelection(td);
					Table.normalizeTable(
						Dom.closest(
							td,
							'table',
							editor.editor
						) as HTMLTableElement
					);
				});
			});
	}

	@autobind
	private observe(table: HTMLTableElement) {
		if (dataBind(table, key)) {
			return;
		}

		dataBind(table, key, true);

		this.j.e
			.on(table, 'mouseleave.resize-cells', (e: MouseEvent) => {
				if (
					this.resizeHandler &&
					this.resizeHandler !== e.relatedTarget
				) {
					this.hideResizeHandle();
				}
			})
			.on(
				table,
				'mousemove.resize-cells touchmove.resize-cells',
				(event: MouseEvent) => {
					const cell = Dom.up(
						event.target as HTMLElement,
						elm => Dom.isCell(elm, this.j.editorWindow),
						table
					) as HTMLTableCellElement;

					if (!cell) {
						return;
					}

					this.calcHandlePosition(table, cell, event.offsetX);
				}
			);

		this.createResizeHandle();
	}

	/** @ovveride */
	beforeDestruct(jodit: IJodit): void {
		if (jodit.events) {
			jodit.e.off(this.j.ow, '.resize-cells');
			jodit.e.off('.resize-cells');
		}
	}
}