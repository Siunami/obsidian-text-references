import { Editor, TFile, WorkspaceLeaf, MarkdownView } from "obsidian";
import { EditorView } from "@codemirror/view";
import { v5 as uuidv5 } from "uuid";

import {
	state,
	updateHover,
	getThat,
	getBacklinks,
	updateBacklinks,
	updateCursor,
	getCursor,
	getHover,
	resetCursor,
	updateHoveredCursor,
	updateBacklinkHover,
	getBacklinkHover,
} from "./state";
import {
	processURI,
	getPrefixAndSuffix,
	handleRemoveHoveredCursor,
	checkFocusCursor,
} from "./utils";
import {
	ACTION_TYPE,
	PORTAL_TEXT_SLICE_SIZE,
	REFERENCE_ICON_HEIGHT,
	REFERENCE_REGEX,
	SVG_HOVER_COLOR,
	SVG_HOVER_COLOR_LIGHT,
} from "./constants";
import { collectLeavesByTabHelper } from "./workspace";
import { DocumentLocation, Backlink } from "./types";

export function createReferenceIcon(portalText: string | null = null): {
	span: HTMLSpanElement;
	svg: SVGElement;
} {
	const span = document.createElement("span");

	const height = REFERENCE_ICON_HEIGHT;
	const width = height * 0.9;

	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("width", `${width}`);
	svg.setAttribute("height", `${height}`);
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
	svg.setAttribute("fill", "white");
	svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
	svg.style.border = "3px solid grey";
	svg.style.backgroundColor = "white";
	svg.style.borderRadius = "3px";
	svg.style.cursor = "pointer";

	const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
	line.setAttribute("x1", "3");
	line.setAttribute("y1", `${(height - 3) / 3}`);
	line.setAttribute("x2", "12");
	line.setAttribute("y2", `${(height - 3) / 3}`);
	line.setAttribute("stroke-width", "2"); // Set the stroke weight to 1
	line.setAttribute("stroke", "black"); // Set the stroke color to black

	svg.appendChild(line);

	const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
	line2.setAttribute("x1", "3");
	line2.setAttribute("y1", `${((height - 3) / 3) * 2}`);
	line2.setAttribute("x2", "15");
	line2.setAttribute("y2", `${((height - 3) / 3) * 2}`);
	line2.setAttribute("stroke-width", "2"); // Set the stroke weight to 1
	line2.setAttribute("stroke", "black"); // Set the stroke color to black

	svg.appendChild(line2);

	const line3 = document.createElementNS("http://www.w3.org/2000/svg", "line");
	line3.setAttribute("x1", "3");
	line3.setAttribute("y1", `${((height - 3) / 3) * 3}`);
	line3.setAttribute("x2", "10");
	line3.setAttribute("y2", `${((height - 3) / 3) * 3}`);
	line3.setAttribute("stroke-width", "2"); // Set the stroke weight to 1
	line3.setAttribute("stroke", "black"); // Set the stroke color to black

	svg.appendChild(line3);

	span.appendChild(svg);

	if (portalText != null) {
		let portal = document.createElement("div");
		portal.style.color = "black";
		portal.classList.add("portal");
		portal.innerHTML = portalText;
		span.style.backgroundColor = "white";
		portal.style.userSelect = "none";
		portal.style.pointerEvents = "none";
		span.appendChild(portal);
	}

	// let newSpan: HTMLSpanElement = document.createElement("span");
	// newSpan.innerHTML = "📄";
	// newSpan.style.cursor = "pointer";
	return { span: span, svg };
}

export function updateHoveredCursorColor(span: HTMLSpanElement, user: string) {
	// remove existing cursors
	const svgElement = span.querySelector("svg");
	const portal: HTMLElement | null = span.querySelector(".portal");

	if (svgElement) {
		handleRemoveHoveredCursor(user); // remove any existing hovered reference icon
		svgElement.style.backgroundColor = SVG_HOVER_COLOR;
		if (portal) span.style.backgroundColor = SVG_HOVER_COLOR;
		updateHoveredCursor(svgElement, user); // add the currently hovered reference icon
	}

	// span.style.backgroundColor = SVG_HOVER_COLOR;
	// updateHoveredCursor(span, ACTION_TYPE.CURSOR);
}

function getCodeMirrorEditorView(editor: Editor): EditorView {
	// @ts-ignore this type is missing... but the Obsidian docs tell us to do it this way??
	return editor.cm as EditorView;
}

export function getContainerElement(
	editorOrLeaf: Editor | WorkspaceLeaf
): HTMLElement {
	// @ts-ignore TODO: find a better way to access this... EXTREMELY SKETCHY
	return editorOrLeaf.containerEl;
}

function getBacklinkID(backlink: Backlink): string {
	const jsonString = JSON.stringify(backlink);
	const id = uuidv5(jsonString, "fb813ebb-1b53-4306-aa9c-655627447f0b");
	return `backlink-${id}`;
}

export function getBacklinkContainer(editor: Editor): HTMLElement {
	const containerEl: HTMLElement = getContainerElement(editor);
	const referenceMarkContainerID = "referenceMarkContainer";
	const container = containerEl.querySelector(`#${referenceMarkContainerID}`);
	if (container) {
		return container as HTMLElement;
	} else {
		const newContainer = document.createElement("div");
		newContainer.id = referenceMarkContainerID;
		containerEl.querySelector(".cm-scroller")!.appendChild(newContainer);
		return newContainer;
	}
}

function getReferenceMarks(editor: Editor): HTMLElement[] {
	const container = getBacklinkContainer(editor);
	const elements: HTMLElement[] = [];
	for (let i = 0; i < container.children.length; i++) {
		elements.push(container.children.item(i) as HTMLElement);
	}
	return elements;
}

function getLeafBBoxElements(leaf: WorkspaceLeaf) {
	const title = getContainerElement(leaf).querySelector(".inline-title");
	if (!title) {
		throw new Error("Missing title");
	}
	const titleBbox = title.getBoundingClientRect();
	const line = getContainerElement(leaf).querySelector(".cm-line");
	if (!line) {
		throw new Error("Document has no lines");
	}
	const lineBbox = line.getBoundingClientRect();

	return { titleBbox, lineBbox };
}

export function updateBacklinkMarkPosition(
	leaf: WorkspaceLeaf,
	backlinksToLeaf: Backlink[],
	showPortals: boolean
) {
	const editor = getMarkdownView(leaf).editor;
	const backlinkContainer = getBacklinkContainer(editor);

	let backlinks = [];
	for (let i = 0; i < backlinkContainer.children.length; i++) {
		backlinks.push(backlinkContainer.children.item(i) as HTMLElement);
	}
	let backlinkIds: string[] = backlinksToLeaf.map((x) => getBacklinkID(x));
	backlinks
		.map((x: HTMLSpanElement) => x.id)
		.forEach((id) => {
			if (!backlinkIds.includes(id)) {
				let element = document.getElementById(id);
				if (element) element.remove();
			}
		});

	const { titleBbox, lineBbox } = getLeafBBoxElements(leaf);

	let referenceMarkers = backlinksToLeaf.map((backlink) => {
		const { from } = backlink.referencedLocation;

		const bbox = getCodeMirrorEditorView(editor).coordsAtPos(from);
		if (!bbox) return;

		let referenceMarker = backlinkContainer.querySelector(
			`#${getBacklinkID(backlink)}`
		) as HTMLElement | null;

		if (referenceMarker === null) {
			referenceMarker = createBacklinkMark(backlink);
			backlinkContainer.appendChild(referenceMarker);
		}

		if (bbox) {
			referenceMarker.style.position = "absolute";

			referenceMarker.setAttribute("top", bbox.top.toString());
			referenceMarker.style.top = bbox.top - titleBbox.top + 32 + "px";
			referenceMarker.style.left = lineBbox.width + 40 + "px";
		}

		return referenceMarker;
	});

	let lastYBottom = -Infinity; // for large documents 😁
	let margin = 4;
	referenceMarkers
		.sort(
			(a, b) =>
				parseInt(a!.getAttribute("top")!) - parseInt(b!.getAttribute("top")!)
		)
		.forEach((marker) => {
			if (!marker) return;
			// toggle portals
			const portal: HTMLElement | null = marker.querySelector(".portal");
			const svg = marker.querySelector("svg");
			if (showPortals) {
				if (svg && !portal) svg.style.display = "inline";
				else if (svg) svg.style.display = "none";

				if (portal) {
					portal.style.display = "inline";
					marker.style.border = "3px solid grey";
					marker.style.padding = "3px";
					marker.style.borderRadius = "3px";
					marker.style.backgroundColor = "white";
				}
			} else {
				if (svg) svg.style.display = "inline";
				if (portal) {
					portal.style.display = "none";
					marker.style.border = "none";
					marker.style.padding = "0px";
					marker.style.borderRadius = "0px";
					marker.style.backgroundColor = "";
				}
			}
			// get positioning
			let top = parseInt(marker!.getAttribute("top")!);
			top = Math.max(top, lastYBottom + margin);
			lastYBottom = top + marker.getBoundingClientRect().height + margin;
			marker.setAttribute("top", top.toString());
			marker.style.top = top - titleBbox.top + 32 + "px";
			marker.style.left = lineBbox.width + 40 + "px";
		});
}

export async function updateBacklinkMarkPositions() {
	await recomputeReferencesForPage();
	const { workspace } = getThat();
	const leaves = workspace.getLeavesOfType("markdown") as WorkspaceLeaf[];

	const allBacklinks: Backlink[] = getBacklinks();
	leaves.forEach((leaf) => {
		const backlinksToLeaf = allBacklinks.filter(
			// @ts-ignore
			(b) => b.referencedLocation.filename == leaf.view.file.path
		);
		// width 900, show the reference
		const showPortals = getContainerElement(leaf).innerWidth > 900;
		updateBacklinkMarkPosition(leaf, backlinksToLeaf, showPortals);
	});
}

export function createBacklinkMark(backlink: Backlink): HTMLElement {
	// Andy's notes on laying out the references so that they don't collide
	// 1. in this function, store the bbox.top in an attribute so that you can use it later
	// 2. separately, do a global layout pass whenever the geometry changes or also on edits (With debounce)
	//    in that global layout pass, sort all the references by bbox.top (via the attribute), then greedily layout
	//	  let lastYBottom; for the first one, place it where it wants to be. then set lastYBottom to that bbox.top plus its height
	//	  then, for the rest, set their top to max(bbox.top, lastYBottom + margin)
	// think about the case where the backlink is to an isolated quote

	let { span } = createReferenceIcon(backlink.portalText);
	span.style.position = "absolute";

	span.id = getBacklinkID(backlink);
	span.setAttribute("reference", JSON.stringify(backlink));

	span.addEventListener("mouseenter", async () => {
		// remove existing cursors
		updateHoveredCursorColor(span, ACTION_TYPE.BACKLINK);
	});

	span.addEventListener("mouseleave", async () => {
		const svgElement = span.querySelector("svg");
		if (svgElement) {
			svgElement.style.backgroundColor = "white";
		}

		const portal: HTMLElement | null = span.querySelector(".portal");
		if (portal) {
			span.style.backgroundColor = "white";
		}
		handleRemoveHoveredCursor(ACTION_TYPE.BACKLINK);
	});

	span.addEventListener("click", openBacklinkReference);

	return span;
}

export function addReferencesToLeaf(leaf: WorkspaceLeaf) {
	const markdownView = getMarkdownView(leaf);
	let workspaceTabs = markdownView.containerEl.closest(".workspace-tabs");
	if (!workspaceTabs) {
		throw new Error("Missing workspace tabs");
	}

	updateBacklinkMarkPositions();

	getContainerElement(markdownView.editor)
		.querySelector(".cm-scroller")!
		.addEventListener("scroll", () => {
			updateBacklinkMarkPositions();
		});

	let resizeObserver = new ResizeObserver(() => {
		updateBacklinkMarkPositions();
	});

	resizeObserver.observe(workspaceTabs);
}

export function getMarkdownView(leaf: WorkspaceLeaf): MarkdownView {
	if (!(leaf.view instanceof MarkdownView)) {
		throw new Error("Unexpected non-markdown view");
	}
	return leaf.view as MarkdownView;
}

function getFilename(leaf: WorkspaceLeaf): string {
	const { file } = getMarkdownView(leaf);
	if (!file) {
		throw new Error("Unexpected missing file");
	}
	return file.name;
}

function createBacklinkData(
	referencingFileData: string,
	referencingFile: TFile
): Backlink[] {
	let backlinks: Backlink[] = [];

	let matches = [...referencingFileData.matchAll(REFERENCE_REGEX)];
	matches.forEach((match) => {
		let [prefix, text, suffix, filename, from, to, portal] = processURI(
			match[1]
		);
		const referencedLocation: DocumentLocation = {
			prefix,
			text,
			suffix,
			filename,
			from,
			to,
		};

		// 1. find the line which includes match.index
		// 2. strip out all the links in that line
		// 3. extract the first N characters of the line
		// const portalText = referencingFileData.slice(
		// 	match.index! - PORTAL_TEXT_SLICE_SIZE,
		// 	PORTAL_TEXT_SLICE_SIZE
		// );

		let index = referencingFileData.indexOf(match[0]);

		const referencingSurroundingStrings = getPrefixAndSuffix(
			referencingFileData,
			index,
			index + match[0].length
		);

		// console.log(match);
		// console.log(text);
		// console.log(referencingSurroundingStrings);
		// console.log(referencingFileData.slice(index, index + match[0].length));

		const referencingLocation: DocumentLocation = {
			// prefix: referencingFileData.slice(index - 25, index),
			prefix: referencingSurroundingStrings.prefix,
			text: referencingFileData.slice(index, index + match[0].length),
			// suffix: referencingFileData.slice(
			// 	index + match[0].length,
			// 	index + match[0].length + 25
			// ),
			suffix: referencingSurroundingStrings.suffix,
			filename: referencingFile.path,
			from: match.index!, // TODO do weird string format
			to: match.index! + match[0].length, // TODO do weird string format
		};

		if (portal == "portal") {
			// OR no-portal
			// console.log("PORTAL");
			// console.log(prefix, text, suffix, filename, from, to, portal);
			// get all the text from the start of the line to the end of the line
			const getLineText = (text: string, index: number): string => {
				const startOfLine = text.lastIndexOf("\n", index - 1) + 1;
				const endOfLine = text.indexOf("\n", index);
				return text.slice(
					startOfLine,
					endOfLine !== -1 ? endOfLine : undefined
				);
			};

			let line = getLineText(referencingFileData, index);
			let portalText = line.replace(new RegExp(REFERENCE_REGEX, "g"), "");
			let portalTextSlice = portalText.slice(0, PORTAL_TEXT_SLICE_SIZE);

			backlinks.push({
				referencedLocation,
				referencingLocation,
				dataString: match[1],
				portalText: portalTextSlice,
			});
		} else {
			backlinks.push({
				referencedLocation,
				referencingLocation,
				dataString: match[1],
			});
		}
	});
	return backlinks;
}

let debounceTimer: NodeJS.Timeout;
export function generateBacklinks() {
	clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		console.log("generating references");
		let backlinks: Backlink[] = [];
		let markdownFiles = this.app.vault.getMarkdownFiles();

		Promise.all(
			markdownFiles.map((file: TFile) => this.app.vault.read(file))
		).then((files) => {
			const zippedArray = markdownFiles.map((file: TFile, index: number) => ({
				markdownFile: file,
				fileData: files[index],
			}));

			zippedArray.forEach((file: { markdownFile: TFile; fileData: string }) => {
				backlinks.push(...createBacklinkData(file.fileData, file.markdownFile));
			});

			updateBacklinks(backlinks);

			const leaves = this.app.workspace.getLeavesOfType("markdown");

			leaves.forEach((leaf: WorkspaceLeaf) => {
				addReferencesToLeaf(leaf);
			});
		});
	}, 100);
}

export async function recomputeReferencesForPage() {
	setTimeout(async () => {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		leaves.forEach(async (leaf: WorkspaceLeaf) => {
			// const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
			// if (!activeLeaf) return;
			const view = getMarkdownView(leaf);
			const file = view.file;
			if (!file) throw new Error("Missing file");
			const fileData = await this.app.vault.read(file);
			const references: Backlink[] = createBacklinkData(fileData, file);

			updateBacklinks(references);
		});
	}, 300);
}

export async function openBacklinkReference(ev: MouseEvent) {
	let cursor = getCursor();
	let hover = getBacklinkHover();
	let leaf = getThat().workspace.getLeafById(hover.leafId);

	// @ts-ignore
	let container = leaf.containerEl;
	if (!container) throw new Error("Container not found");
	container.querySelector(".view-content").style.boxShadow = "none";

	if (
		cursor &&
		hover &&
		cursor.dataString &&
		hover.dataString &&
		cursor.dataString == hover.dataString
	) {
		updateCursor({
			temp: false,
			cursorViewport: null,
			peek: false,
		});
	}
	updateBacklinkHover({
		temp: false,
		cursorViewport: null,
		peek: false,
	});

	handleRemoveHoveredCursor(ACTION_TYPE.CURSOR);

	resetCursor();
}

export async function openReference(ev: MouseEvent) {
	let cursor = getCursor();
	let hover = getHover();
	let leaf = getThat().workspace.getLeafById(hover.leafId);

	// @ts-ignore
	let container = leaf.containerEl;
	if (!container) throw new Error("Container not found");
	container.querySelector(".view-content").style.boxShadow = "none";

	if (
		cursor &&
		hover &&
		cursor.dataString &&
		hover.dataString &&
		cursor.dataString == hover.dataString
	) {
		updateCursor({
			temp: false,
			cursorViewport: null,
			peek: false,
		});
	}
	updateHover({
		temp: false,
		cursorViewport: null,
		peek: false,
	});

	handleRemoveHoveredCursor(ACTION_TYPE.CURSOR);

	resetCursor();
}
