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
	const vertexData = new Float32Array(numVertices * 2);

	let offset = 0;
	function addVertex(x, y) {
		vertexData[offset++] = x;
		vertexData[offset++] = y;
	}

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

		addVertex(c1 * radius, s1 * radius);
		addVertex(c2 * radius, s2 * radius);
		addVertex(c1 * innerRadius, s1 * innerRadius);

		addVertex(c1 * innerRadius, s1 * innerRadius);
		addVertex(c2 * radius, s2 * radius);
		addVertex(c2 * innerRadius, s2 * innerRadius);
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
			struct OurStruct {
				color: vec4f,
				offset: vec2f,
			};

			struct OtherStruct {
				scale: vec2f,
			};

			struct Vertex {
				position: vec2f,
			};

			@group(0) @binding(0) var<storage, read> ourStructs: array<OurStruct>;
			@group(0) @binding(1) var<storage, read> otherStructs: array<OtherStruct>;
			@group(0) @binding(2) var<storage, read> pos: array<Vertex>;

			struct VsOutput {
				@builtin(position) position: vec4f,
				@location(0) color: vec4f,
			};

		  @vertex fn vs(
				@builtin(vertex_index) vertexIndex: u32,
				@builtin(instance_index) instanceIndex: u32
			) -> VsOutput {
				let ourStruct = ourStructs[instanceIndex];
				let otherStruct = otherStructs[instanceIndex];

				var vsOutput: VsOutput;
				vsOutput.position = vec4f(pos[vertexIndex].position * otherStruct.scale + ourStruct.offset, 0.0, 1.0);
				vsOutput.color = ourStruct.color;
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
		2 * 4 + // offset: vec2f,
		2 * 4;  // padding
	const changingUnitSize =
		2 * 4;  // scale: vec2f
	const staticStorageBufferSize = staticUnitSize * kNumObjects;
	const changingStorageBufferSize = changingUnitSize * kNumObjects;

	const staticStorageBuffer = device.createBuffer({
		size: staticStorageBufferSize,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	});

	const changingStorageBuffer = device.createBuffer({
		size: changingStorageBufferSize,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	});

	const kColorOffset = 0;
	const kOffsetOffset = 4;

	const kScaleOffset = 0;

	const pipeline = device.createRenderPipeline({
		label: "demo render pipeline",
		layout: "auto",
		vertex: {
			entryPoint: "vs",
			module,
		},
		fragment: {
			entryPoint: "fs",
			module,
			targets: [{ format }],
		}
	});

	{
		const staticStorageValues = new Float32Array(staticStorageBufferSize / Float32Array.BYTES_PER_ELEMENT);
		for (let i = 0; i < kNumObjects; i++) {
			const staticOffset = i * (staticUnitSize / Float32Array.BYTES_PER_ELEMENT)
			staticStorageValues.set([rand(), rand(), rand(), 1], staticOffset + kColorOffset);
			staticStorageValues.set([rand(-0.9, 0.9), rand(-0.9, 0.9)], staticOffset + kOffsetOffset);

			objectInfos.push({
				scale: rand(0.2, 0.5),
			})
		}

		device.queue.writeBuffer(staticStorageBuffer, 0, staticStorageValues);
	}

	const storageValues = new Float32Array(changingStorageBufferSize / Float32Array.BYTES_PER_ELEMENT);

	const { vertexData, numVertices } = createCircleVertices({
		radius: 0.5,
		innerRadius: 0.25,
	});
	const vertexStorageBuffer = device.createBuffer({
		size: vertexData.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
	});
	device.queue.writeBuffer(vertexStorageBuffer, 0, vertexData);

	const bindGroup = device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: staticStorageBuffer },
			{ binding: 1, resource: changingStorageBuffer },
			{ binding: 2, resource: vertexStorageBuffer },
		]
	});

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

		const aspect = canvas.width / canvas.height;
		objectInfos.forEach(({ scale }, i) => {
			const offset = i * (changingUnitSize / Float32Array.BYTES_PER_ELEMENT);
			storageValues.set([scale / aspect, scale], offset + kScaleOffset);
		});
		device.queue.writeBuffer(changingStorageBuffer, 0, storageValues);
		pass.setBindGroup(0, bindGroup);
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
