import { CloudBuilder } from "./lib/cloud-builder.js";
import { EtchRenderer } from "./lib/etch-render.js";

// TODO: Watch for changes to attributes and re-render the cloud when they change
// TODO: Implement pixel perfect resizing of the canvas when the element is resized

export class Cumulus extends HTMLElement {
  connectedCallback() {
    // Only create the shadow root and canvas if they haven't been created yet
    if (this.shadowRoot) return;

    const width = Number(this.getAttribute("width")) || 500;
    const height = Number(this.getAttribute("height")) || 500;
    const numCells = Number(this.getAttribute("numCells")) || 10;
    const seed = Number(this.getAttribute("seed")) || 42; // TODO: randomize seed if not provided
    const lineWidth = Number(this.getAttribute("lineWidth")) || 2;
    const lineSpacing = Number(this.getAttribute("lineWidth")) || 2;

    // Initialise the cloud builder and generate the starting cells
    this.cloudBuilder = new CloudBuilder(width, height, numCells, seed);
    /*console.log(
      "Generated cells:",
      JSON.stringify(this.cloudBuilder.cells, null, 2),
    );*/

    const shadow = this.attachShadow({ mode: "open" });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    shadow.append(canvas);

    this.renderer = new EtchRenderer(canvas, lineWidth, lineSpacing);
    this.renderer.setBackground("rgba(220, 239, 247, 1)");
    //this.renderer.setBackgroundPadding()
    //this.renderer.setBackgroundMask()
    //this.renderer.setBackgroundBoxNoise({leftVert, rightVert, topHor, bottomHor})
    //this.renderer.setLineWidth()
    //this.renderer.setLineSpacing()
    //this.renderer.setWaves/WaveMap()
    //this.renderer.setLineEndShape() // flat, rounded
    //this.renderer.setBorderLinesEndShape() // tapered, rounded, noise on length, occassional dot at the end
    //this.renderer.addLayer(json)
    /*this.renderer.addCircleLayer({
      x: 300,
      y: 200,
      radius: 50,
      fill: "blue",
      rhsLenNoise: 10,
      lhsLenNoise: 10,
      lhsLinePadding: 5,
      rhsLinePadding: 5,
      specialType: "cloud-cell",
    });*/
    for (const fillCircle of this.cloudBuilder.fillCircles) {
      this.renderer.addCircleLayer({
        x: fillCircle.x,
        y: fillCircle.y,
        radius: fillCircle.radius,
        fill: "lightgrey",
        rhsLenNoise: 10,
        lhsLenNoise: 10,
        lhsLinePadding: 5,
        rhsLinePadding: 5,
      });
    }
    this.renderer.addRightAnglePolygonLayer({
      vertices: this.cloudBuilder.cloudInnerRight,
      fill: "lightgrey",
      rhsLenNoise: 10,
      lhsLenNoise: 10,
      lhsLinePadding: 5,
      rhsLinePadding: 5,
      // TODO: Top and bottom noise
    });
    this.renderer.addRightAnglePolygonLayer({
      vertices: this.cloudBuilder.cloudInnerLeft,
      fill: "lightgrey",
      rhsLenNoise: 10,
      lhsLenNoise: 10,
      lhsLinePadding: 5,
      rhsLinePadding: 5,
      // TODO: Top and bottom noise
    });

    this.addCloudCellLayers(this.cloudBuilder.cells);
    this.addCloudCellLayers(this.cloudBuilder.cells);
    this.renderer.draw();

    //this.renderer.renderCells(this.cloudBuilder.cells);
    //this.renderer.renderCells(this.cloudBuilder.fillCircles);
    //this.renderer.renderPolygon(this.cloudBuilder.cloudInnerRight);
    //this.renderer.renderPolygon(this.cloudBuilder.cloudInnerLeft);

    /*
    // Draw the dome and border for testing
    const context = canvas.getContext("2d");
    if (!context) return;

    // Draw the dome
    context.beginPath();
    context.arc(
      this.cloudBuilder.dome.x,
      this.cloudBuilder.dome.y,
      this.cloudBuilder.dome.radius,
      Math.PI,
      2 * Math.PI,
    );
    context.strokeStyle = "grey";
    context.lineWidth = 1;
    context.stroke();

    // Draw the border around the canvas
    context.strokeRect(0, 0, width, height);

    // Draw the centreline
    context.beginPath();
    context.moveTo(
      this.cloudBuilder.dome.x,
      this.cloudBuilder.dome.y - this.cloudBuilder.dome.radius,
    );
    context.lineTo(this.cloudBuilder.dome.x, this.cloudBuilder.dome.y);
    context.stroke();*/
  }

  addCloudCellLayer(cell) {
    this.renderer.addCircleLayer({
      x: cell.x,
      y: cell.y,
      radius: cell.radius,
      fill: "grey",
      rhsLenNoise: 10,
      lhsLenNoise: 10,
      lhsLinePadding: 5,
      rhsLinePadding: 5,
      specialType: "cloud-cell",
    });
  }

  addCloudCellLayers(cells) {
    for (const cell of cells) {
      this.addCloudCellLayer(cell);
    }
  }
}
