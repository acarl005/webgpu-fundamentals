function rand(min, max) {
	if (min === undefined) {
		min = 0;
		max = 1;
	} else if (max === undefined) {
		max = min;
		min = 0;
	}
	return min + Math.random() * (max - min);
}

function createCircleVertices({
	radius = 1,
	numSubdivisions = 24,
	innerRadius = 0,
	startAngle = 0,
	endAngle = Math.PI * 2,
} = {}) {
	const numVertices = numSubdivisions * 3 * 2;
	const vertexData = new Float32Array(numVertices * (2 + 3));

	let offset = 0;
	function addVertex(x, y, r, g, b) {
		vertexData[offset++] = x;
		vertexData[offset++] = y;
		vertexData[offset++] = r;
		vertexData[offset++] = g;
		vertexData[offset++] = b;
	}

	const innerColor = [1, 1, 1];
	const outerColor = [0.1, 0.1, 0.1];

	// 2 triangles per subdivision
	//
	// 0--1 4
	// | / /|
	// |/ / |
	// 2 3--5
	for (let i = 0; i < numSubdivisions; i++) {
		const angle1 = startAngle + (i + 0) * (endAngle - startAngle) / numSubdivisions;
		const angle2 = startAngle + (i + 1) * (endAngle - startAngle) / numSubdivisions;

		const c1 = Math.cos(angle1);
		const c2 = Math.cos(angle2);
		const s1 = Math.sin(angle1);
		const s2 = Math.sin(angle2);

		addVertex(c1 * radius, s1 * radius, ...outerColor);
		addVertex(c2 * radius, s2 * radius, ...outerColor);
		addVertex(c1 * innerRadius, s1 * innerRadius, ...innerColor);

		addVertex(c1 * innerRadius, s1 * innerRadius, ...innerColor);
		addVertex(c2 * radius, s2 * radius, ...outerColor);
		addVertex(c2 * innerRadius, s2 * innerRadius, ...innerColor);
	}

	return {
		vertexData,
		numVertices
	};
}

async function main() {
	const adapter = await navigator.gpu?.requestAdapter();
	const device = await adapter?.requestDevice();
	if (!device) {
		console.error("WebGPU not supported");
		return;
	}

	const canvas = document.querySelector("canvas");
	const context = canvas.getContext("webgpu");
	const format = navigator.gpu.getPreferredCanvasFormat();
	context.configure({
		device,
		format
	});

	const module = device.createShaderModule({
		label: "our hardcoded green triangle shaders",
		code: /* wgsl */`
			struct Vertex {
				@location(0) position: vec2f,
				@location(1) color: vec4f,
				@location(2) offset: vec2f,
				@location(3) scale: vec2f,
				@location(4) perVertexColor: vec3f,
			};

			struct VsOutput {
				@builtin(position) position: vec4f,
				@location(0) color: vec4f,
			};

		  @vertex fn vs(
				vert: Vertex,
			) -> VsOutput {
				var vsOutput: VsOutput;
				vsOutput.position = vec4f(vert.position * vert.scale + vert.offset, 0.0, 1.0);
				vsOutput.color = vert.color * vec4f(vert.perVertexColor, 1);
				return vsOutput;
			}

			@fragment fn fs(vsOutput: VsOutput) -> @location(0) vec4f {
				return vsOutput.color;
			}
		`
	});

	const kNumObjects = 100;
	const objectInfos = [];

	const staticUnitSize =
		4 * 4 + // color: vec4f,
		2 * 4;  // offset: vec2f,
	const changingUnitSize =
		2 * 4;  // scale: vec2f
	const staticVertexBufferSize = staticUnitSize * kNumObjects;
	const changingVertexBufferSize = changingUnitSize * kNumObjects;

	const staticVertexBuffer = device.createBuffer({
		size: staticVertexBufferSize,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});

	const changingVertexBuffer = device.createBuffer({
		size: changingVertexBufferSize,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});

	const kColorOffset = 0;
	const kOffsetOffset = 4;

	const kScaleOffset = 0;

	const pipeline = device.createRenderPipeline({
		label: "vertex buffer pipeline",
		layout: "auto",
		vertex: {
			entryPoint: "vs",
			module,
			buffers: [
				{
					arrayStride: 5 * Float32Array.BYTES_PER_ELEMENT,
					attributes: [
						{ shaderLocation: 0, format: "float32x2", offset: 0 }, // position
						{ shaderLocation: 4, format: "float32x3", offset: 2 * Float32Array.BYTES_PER_ELEMENT } // perVertexColor
					]
				},
				{
					arrayStride: 6 * Float32Array.BYTES_PER_ELEMENT,
					stepMode: "instance",
					attributes: [
						{ shaderLocation: 1, format: "float32x4", offset: 0 }, // color
						{ shaderLocation: 2, format: "float32x2", offset: 4 * Float32Array.BYTES_PER_ELEMENT } // offset
					]
				},
				{
					arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
					stepMode: "instance",
					attributes: [
						{ shaderLocation: 3, format: "float32x2", offset: 0 } // scale
					]
				}
			]
		},
		fragment: {
			entryPoint: "fs",
			module,
			targets: [{ format }],
		}
	});

	{
		const staticVertexValues = new Float32Array(staticVertexBufferSize / Float32Array.BYTES_PER_ELEMENT);
		for (let i = 0; i < kNumObjects; i++) {
			const staticOffset = i * (staticUnitSize / Float32Array.BYTES_PER_ELEMENT)
			staticVertexValues.set([rand(), rand(), rand(), 1], staticOffset + kColorOffset);
			staticVertexValues.set([rand(-0.9, 0.9), rand(-0.9, 0.9)], staticOffset + kOffsetOffset);

			objectInfos.push({
				scale: rand(0.2, 0.5),
			})
		}

		device.queue.writeBuffer(staticVertexBuffer, 0, staticVertexValues);
	}

	const storageValues = new Float32Array(changingVertexBufferSize / Float32Array.BYTES_PER_ELEMENT);

	const { vertexData, numVertices } = createCircleVertices({
		radius: 0.5,
		innerRadius: 0.25,
	});
	const vertexBuffer = device.createBuffer({
		size: vertexData.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
	});
	device.queue.writeBuffer(vertexBuffer, 0, vertexData);

	const renderPassDesc = {
		label: "demo render pass descriptor",
		colorAttachments: [
			{
				//view: TODO
				clearValue: [0.3, 0.3, 0.3, 1.0],
				loadOp: "clear",
				storeOp: "store",
			}
		]
	};

	function render() {
		renderPassDesc.colorAttachments[0].view = context.getCurrentTexture().createView();

		const encoder = device.createCommandEncoder({ label: "our demo encoder" });
		const pass = encoder.beginRenderPass(renderPassDesc);
		pass.setPipeline(pipeline);
		pass.setVertexBuffer(0, vertexBuffer);
		pass.setVertexBuffer(1, staticVertexBuffer);
		pass.setVertexBuffer(2, changingVertexBuffer);

		const aspect = canvas.width / canvas.height;
		objectInfos.forEach(({ scale }, i) => {
			const offset = i * (changingUnitSize / Float32Array.BYTES_PER_ELEMENT);
			storageValues.set([scale / aspect, scale], offset + kScaleOffset);
		});
		device.queue.writeBuffer(changingVertexBuffer, 0, storageValues);
		pass.draw(numVertices, kNumObjects);

		pass.end();

		const commandBuffer = encoder.finish();
		device.queue.submit([commandBuffer]);
	}

	const observer = new ResizeObserver(entries => {
		for (const entry of entries) {
			const canvas = entry.target;
			const width = entry.contentBoxSize[0].inlineSize;
			const height = entry.contentBoxSize[0].blockSize;
			canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
			canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
		}
		render();
	});

	observer.observe(canvas);
}
main()
