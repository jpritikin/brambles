// THH dose -> optimism VU meter, for content/docs/psychoactive/thh/_index.md.
// Purely playful/illustrative: there's no real dose-response data behind the
// mapping, just a monotonic log-scale guess dressed up as a hi-fi VU meter.
// Mounts into <div id="thh-vu-meter"> if present on the page.

const MIN_DOSE = 5;
const MAX_DOSE = 1000;
const LEVELS = 11;

// Knob rotates through this arc (degrees), 0 = min dose, pointing straight
// down-left, sweeping clockwise to down-right at max dose.
const KNOB_MIN_ANGLE = -135;
const KNOB_MAX_ANGLE = 135;

// Classic VU meter needle sweep: rests to the left, swings clockwise.
// Symmetric around straight up (0deg).
const NEEDLE_SWEEP = 25;
const NEEDLE_MIN_ANGLE = -NEEDLE_SWEEP;
const NEEDLE_MAX_ANGLE = NEEDLE_SWEEP;

const LEVEL_DESCRIPTIONS = [
    "barely noticeable, threshold dose",
    "a faint hint of ease, like the first sip of a good cup of tea",
    "mild, quiet well-being—nothing you'd mention out loud",
    "gentle optimism, the sense that things are basically fine",
    "notably sunny outlook, minor annoyances stop registering",
    "cheerful and unbothered, you start seeing silver linings unprompted",
    "conspicuously upbeat, coworkers ask if you got good news",
    "aggressively positive, you start every sentence with \"well, on the bright side\"",
    "motivational-poster energy, mild eye-rolling from bystanders",
    "one pun away from a group intervention",
    "Dad-level pathological optimism",
];

// Only the top ("Dad-level") end of the arc is painted red, hifi-VU-meter style.
const RED_ZONE_START_LEVEL = 9;

function doseToLevel(dose: number): number {
    const t = (Math.log(dose) - Math.log(MIN_DOSE)) / (Math.log(MAX_DOSE) - Math.log(MIN_DOSE));
    return Math.min(LEVELS, Math.max(1, Math.round(t * (LEVELS - 1)) + 1));
}

function doseToAngle(dose: number, minAngle: number, maxAngle: number): number {
    const t = (Math.log(dose) - Math.log(MIN_DOSE)) / (Math.log(MAX_DOSE) - Math.log(MIN_DOSE));
    return minAngle + t * (maxAngle - minAngle);
}

function angleToDose(angle: number): number {
    const t = (angle - KNOB_MIN_ANGLE) / (KNOB_MAX_ANGLE - KNOB_MIN_ANGLE);
    const logDose = Math.log(MIN_DOSE) + t * (Math.log(MAX_DOSE) - Math.log(MIN_DOSE));
    return Math.round(Math.exp(logDose));
}

// Builds a vintage hifi-style analog VU meter housing: dark beveled case,
// cream face, dual arc scale (level numbers 1-11 on top, a decorative
// 0-100 scale below), a red zone at the top end of the arc, and a swinging
// needle. Purely numeric readout on the face itself—the text description
// lives outside the meter.
function buildVuMeter(container: HTMLElement): { needle: SVGLineElement; danger: SVGTextElement } {
    const WIDTH = 380;
    const HEIGHT = 220;
    const CX = WIDTH / 2;
    const CY = HEIGHT + 160 - 0.1 * HEIGHT;
    const RADIUS = 310;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    svg.style.cssText = "width:100%;max-width:380px;display:block;margin:0 auto;";

    function pointOnArc(radius: number, angleDeg: number): [number, number] {
        const rad = ((angleDeg - 90) * Math.PI) / 180;
        return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
    }

    // Housing: dark bevel case with a lighter bezel inset, like a real VU meter.
    const housing = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    housing.setAttribute("x", "0");
    housing.setAttribute("y", "0");
    housing.setAttribute("width", String(WIDTH));
    housing.setAttribute("height", String(HEIGHT));
    housing.setAttribute("rx", "14");
    housing.setAttribute("fill", "#1c1a17");
    svg.appendChild(housing);

    const bezel = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bezel.setAttribute("x", "10");
    bezel.setAttribute("y", "10");
    bezel.setAttribute("width", String(WIDTH - 20));
    bezel.setAttribute("height", String(HEIGHT - 66));
    bezel.setAttribute("rx", "8");
    bezel.setAttribute("fill", "#37332c");
    svg.appendChild(bezel);

    const FACE_X = 18;
    const FACE_Y = 18;
    const FACE_W = WIDTH - 36;
    const FACE_H = HEIGHT - 82;

    const face = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    face.setAttribute("x", String(FACE_X));
    face.setAttribute("y", String(FACE_Y));
    face.setAttribute("width", String(FACE_W));
    face.setAttribute("height", String(FACE_H));
    face.setAttribute("rx", "4");
    face.setAttribute("fill", "#efe6c9");
    svg.appendChild(face);

    // Clips the needle (and its pivot, which sits below the visible face so
    // its base is never shown) to the face rect, so it reads as swinging
    // behind the housing rather than floating on top of it.
    const clipId = `thh-vu-face-clip-${Math.random().toString(36).slice(2)}`;
    const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
    clipPath.setAttribute("id", clipId);
    const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    clipRect.setAttribute("x", String(FACE_X));
    clipRect.setAttribute("y", String(FACE_Y));
    clipRect.setAttribute("width", String(FACE_W));
    clipRect.setAttribute("height", String(FACE_H));
    clipPath.appendChild(clipRect);
    svg.appendChild(clipPath);

    const needleGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    needleGroup.setAttribute("clip-path", `url(#${clipId})`);
    svg.appendChild(needleGroup);

    // Primary arc: level numbers 1-11, red from RED_ZONE_START_LEVEL onward.
    for (let i = 0; i < LEVELS; i++) {
        const angle = NEEDLE_MIN_ANGLE + (i / (LEVELS - 1)) * (NEEDLE_MAX_ANGLE - NEEDLE_MIN_ANGLE);
        const inRedZone = i + 1 >= RED_ZONE_START_LEVEL;
        const [tx0, ty0] = pointOnArc(RADIUS - 16, angle);
        const [tx1, ty1] = pointOnArc(RADIUS - 2, angle);
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        tick.setAttribute("x1", String(tx0));
        tick.setAttribute("y1", String(ty0));
        tick.setAttribute("x2", String(tx1));
        tick.setAttribute("y2", String(ty1));
        tick.setAttribute("stroke", inRedZone ? "#a52a2a" : "#2b2620");
        tick.setAttribute("stroke-width", "2");
        svg.appendChild(tick);

        const [lx, ly] = pointOnArc(RADIUS - 32, angle);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", String(lx));
        label.setAttribute("y", String(ly));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "middle");
        label.setAttribute("font-size", "14");
        label.setAttribute("font-weight", "700");
        label.setAttribute("fill", inRedZone ? "#a52a2a" : "#2b2620");
        label.textContent = String(i + 1);
        svg.appendChild(label);
    }

    // Red zone arc stroke across the top end, like the "VU" red band.
    const redStartAngle = NEEDLE_MIN_ANGLE + ((RED_ZONE_START_LEVEL - 1) / (LEVELS - 1)) * (NEEDLE_MAX_ANGLE - NEEDLE_MIN_ANGLE);
    const [rx0, ry0] = pointOnArc(RADIUS + 8, redStartAngle);
    const [rx1, ry1] = pointOnArc(RADIUS + 8, NEEDLE_MAX_ANGLE);
    const redArc = document.createElementNS("http://www.w3.org/2000/svg", "path");
    redArc.setAttribute("d", `M ${rx0} ${ry0} A ${RADIUS + 8} ${RADIUS + 8} 0 0 1 ${rx1} ${ry1}`);
    redArc.setAttribute("stroke", "#a52a2a");
    redArc.setAttribute("stroke-width", "3");
    redArc.setAttribute("fill", "none");
    svg.appendChild(redArc);

    // Secondary decorative scale (0-100), echoing the reference meter's dual
    // scale, drawn smaller and closer to the pivot.
    for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        const angle = NEEDLE_MIN_ANGLE + t * (NEEDLE_MAX_ANGLE - NEEDLE_MIN_ANGLE);
        const [lx, ly] = pointOnArc(RADIUS - 62, angle);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", String(lx));
        label.setAttribute("y", String(ly));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "middle");
        label.setAttribute("font-size", "10");
        label.setAttribute("fill", "#6b6350");
        label.textContent = String(i * 20);
        svg.appendChild(label);
    }

    const needle = document.createElementNS("http://www.w3.org/2000/svg", "line");
    needle.setAttribute("x1", String(CX));
    needle.setAttribute("y1", String(CY));
    needle.setAttribute("stroke", "#a52a2a");
    needle.setAttribute("stroke-width", "3");
    needle.setAttribute("stroke-linecap", "round");
    needle.style.transformOrigin = `${CX}px ${CY}px`;
    needle.style.transition = "transform 0.25s ease-out";
    const [nx, ny] = pointOnArc(RADIUS - 24, 0);
    needle.setAttribute("x2", String(nx));
    needle.setAttribute("y2", String(ny));
    needleGroup.appendChild(needle);

    // Bottom trim strip below the face, with a small badge, echoing the
    // reference meter's lower housing panel. Drawn after the clipped needle
    // group so it visually covers the needle's base/pivot.
    const trim = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    trim.setAttribute("x", "10");
    trim.setAttribute("y", String(FACE_Y + FACE_H));
    trim.setAttribute("width", String(WIDTH - 20));
    trim.setAttribute("height", String(HEIGHT - 10 - (FACE_Y + FACE_H)));
    trim.setAttribute("fill", "#37332c");
    svg.appendChild(trim);

    const badge = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    badge.setAttribute("cx", String(CX));
    badge.setAttribute("cy", String(HEIGHT - 30));
    badge.setAttribute("r", "12");
    badge.setAttribute("fill", "#0f0d0b");
    badge.setAttribute("stroke", "#54493a");
    badge.setAttribute("stroke-width", "2");
    svg.appendChild(badge);

    // Semi-transparent DANGER overlay, shown only while the needle sits in the
    // red zone.
    const danger = document.createElementNS("http://www.w3.org/2000/svg", "text");
    danger.setAttribute("x", String(FACE_X + FACE_W / 2));
    danger.setAttribute("y", String(FACE_Y + FACE_H / 2));
    danger.setAttribute("text-anchor", "middle");
    danger.setAttribute("dominant-baseline", "middle");
    danger.setAttribute("font-size", "52");
    danger.setAttribute("font-weight", "900");
    danger.setAttribute("letter-spacing", "2");
    danger.setAttribute("fill", "rgba(165,42,42,0.45)");
    danger.setAttribute("textLength", String(FACE_W - 20));
    danger.setAttribute("lengthAdjust", "spacingAndGlyphs");
    danger.style.transform = "scale(1, 1.8)";
    danger.style.transformOrigin = `${FACE_X + FACE_W / 2}px ${FACE_Y + FACE_H / 2}px`;
    danger.style.pointerEvents = "none";
    danger.style.opacity = "0";
    danger.style.transition = "opacity 1s ease";
    danger.textContent = "DANGER";
    svg.appendChild(danger);
    // DANGER is drawn on the face itself, not clipped with the needle group,
    // so it stays fully legible regardless of needle position.

    container.appendChild(svg);
    return { needle, danger };
}

function setNeedleAngle(needle: SVGLineElement, angle: number) {
    needle.style.transform = `rotate(${angle}deg)`;
}

function buildKnob(container: HTMLElement, initialDose: number, onChange: (dose: number) => void): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:0.5em;margin:0 auto;";

    const KNOB_SIZE = 128;
    const dial = document.createElement("div");
    dial.setAttribute("role", "slider");
    dial.setAttribute("aria-label", "THH dose in milligrams");
    dial.setAttribute("aria-valuemin", String(MIN_DOSE));
    dial.setAttribute("aria-valuemax", String(MAX_DOSE));
    dial.tabIndex = 0;
    dial.style.cssText = `
    width:${KNOB_SIZE}px;height:${KNOB_SIZE}px;border-radius:50%;
    background:radial-gradient(circle at 35% 30%, #6b6b6b, #2b2b2b 70%);
    box-shadow:0 6px 16px rgba(0,0,0,0.4), inset 0 2px 4px rgba(255,255,255,0.15);
    position:relative;cursor:grab;touch-action:none;user-select:none;flex:none;
  `;

    // A smiley face on the knob face itself, rotated as the whole face turns
    // — its tilt at a glance shows how far the dose has been dialed up.
    // The mouth is drawn off-center from the pivot so a bigger grin (drawn
    // wider/higher toward max dose) reads clearly even though the knob only
    // rotates; the eyebrows follow a similar exaggeration.
    const faceSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    faceSvg.setAttribute("viewBox", "0 0 100 100");
    faceSvg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;transform-origin:50% 50%;";

    const leftEye = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    leftEye.setAttribute("cx", "36");
    leftEye.setAttribute("cy", "42");
    leftEye.setAttribute("r", "5");
    leftEye.setAttribute("fill", "#eee");
    faceSvg.appendChild(leftEye);

    const rightEye = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    rightEye.setAttribute("cx", "64");
    rightEye.setAttribute("cy", "42");
    rightEye.setAttribute("r", "5");
    rightEye.setAttribute("fill", "#eee");
    faceSvg.appendChild(rightEye);

    const mouth = document.createElementNS("http://www.w3.org/2000/svg", "path");
    mouth.setAttribute("stroke", "#eee");
    mouth.setAttribute("stroke-width", "4");
    mouth.setAttribute("stroke-linecap", "round");
    mouth.setAttribute("fill", "none");
    faceSvg.appendChild(mouth);

    dial.appendChild(faceSvg);

    for (let i = 0; i < LEVELS; i++) {
        const t = i / (LEVELS - 1);
        const angle = KNOB_MIN_ANGLE + t * (KNOB_MAX_ANGLE - KNOB_MIN_ANGLE);
        const tick = document.createElement("div");
        tick.style.cssText = `
      position:absolute;top:50%;left:50%;width:3px;height:${KNOB_SIZE / 2 + 10}px;
      background:transparent;transform:translate(-50%,-100%) rotate(${angle}deg);
      transform-origin:50% 100%;pointer-events:none;
    `;
        const mark = document.createElement("div");
        mark.style.cssText = "width:3px;height:8px;background:rgba(128,128,128,0.6);margin:0 auto;";
        tick.appendChild(mark);
        dial.appendChild(tick);
    }

    wrap.appendChild(dial);

    const readout = document.createElement("div");
    readout.style.cssText = "font-size:0.95em;text-align:center;";
    wrap.appendChild(readout);

    let dose = initialDose;

    function render() {
        faceSvg.style.transform = `rotate(${doseToAngle(dose, KNOB_MIN_ANGLE, KNOB_MAX_ANGLE)}deg)`;
        const level = doseToLevel(dose);
        const t = (level - 1) / (LEVELS - 1);
        // Mouth curves from a flat line (low dose) to a wide toothy grin
        // (max dose): the curve's sag/lift and its vertical span both grow with t.
        const lift = 6 + t * 22;
        mouth.setAttribute("d", `M 30 60 Q 50 ${60 + lift} 70 60`);
        dial.setAttribute("aria-valuenow", String(dose));
        readout.innerHTML = `Dose: <strong>${dose}</strong> mg`;
        onChange(dose);
    }

    function setDoseFromAngle(rawAngle: number) {
        const clamped = Math.max(KNOB_MIN_ANGLE, Math.min(KNOB_MAX_ANGLE, rawAngle));
        dose = angleToDose(clamped);
        render();
    }

    function angleFromPointer(clientX: number, clientY: number): number {
        const rect = dial.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        // 0 degrees = straight up, positive = clockwise, matching KNOB_MIN/MAX_ANGLE.
        const rad = Math.atan2(clientX - cx, -(clientY - cy));
        return (rad * 180) / Math.PI;
    }

    let dragging = false;
    // Tracked as a running delta from the previous pointer position rather
    // than an absolute angle, so swinging the cursor through the knob's dead
    // zone (straight down, where atan2 wraps between +180 and -180) doesn't
    // snap the dose straight to the opposite end.
    let lastPointerAngle = 0;
    let currentAngle = 0;

    function pointerMove(e: PointerEvent) {
        if (!dragging) return;
        const angle = angleFromPointer(e.clientX, e.clientY);
        let delta = angle - lastPointerAngle;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        lastPointerAngle = angle;
        currentAngle = Math.max(KNOB_MIN_ANGLE, Math.min(KNOB_MAX_ANGLE, currentAngle + delta));
        setDoseFromAngle(currentAngle);
    }

    function pointerUp() {
        dragging = false;
        dial.style.cursor = "grab";
        window.removeEventListener("pointermove", pointerMove);
        window.removeEventListener("pointerup", pointerUp);
    }

    dial.addEventListener("pointerdown", (e) => {
        dragging = true;
        dial.style.cursor = "grabbing";
        lastPointerAngle = angleFromPointer(e.clientX, e.clientY);
        currentAngle = doseToAngle(dose, KNOB_MIN_ANGLE, KNOB_MAX_ANGLE);
        window.addEventListener("pointermove", pointerMove);
        window.addEventListener("pointerup", pointerUp);
    });

    dial.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 50 : 5;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            dose = Math.min(MAX_DOSE, dose + step);
            render();
            e.preventDefault();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            dose = Math.max(MIN_DOSE, dose - step);
            render();
            e.preventDefault();
        }
    });

    container.appendChild(wrap);
    render();
    return dial;
}

function initMeter(container: HTMLElement) {
    container.style.cssText = "max-width:420px;margin:1em auto;padding:0.6em;border:1px solid rgba(128,128,128,0.35);border-radius:12px;text-align:center;";

    const { needle, danger } = buildVuMeter(container);

    const description = document.createElement("div");
    description.style.cssText = "font-size:1em;font-style:italic;line-height:1.3em;height:2.6em;margin:0.6em 0 0.8em;display:flex;align-items:center;justify-content:center;text-align:center;";
    container.appendChild(description);

    // The level-11 label carries a footnote reference; Hugo/goldmark assigns
    // and renders that footnote's number from this pre-rendered markup, so the
    // widget just borrows it rather than guessing the footnote's number itself.
    const maxLabelSource = document.getElementById("thh-vu-max-label");
    const maxLabelHtml = maxLabelSource?.querySelector("p")?.innerHTML ?? LEVEL_DESCRIPTIONS[LEVELS - 1];

    buildKnob(container, MIN_DOSE, (dose) => {
        const level = doseToLevel(dose);
        setNeedleAngle(needle, doseToAngle(dose, NEEDLE_MIN_ANGLE, NEEDLE_MAX_ANGLE));
        if (level === LEVELS) {
            description.innerHTML = maxLabelHtml;
        } else {
            description.textContent = LEVEL_DESCRIPTIONS[level - 1];
        }
        danger.style.opacity = level >= RED_ZONE_START_LEVEL ? "1" : "0";
    });
}

const el = document.getElementById("thh-vu-meter");
if (el) initMeter(el);
