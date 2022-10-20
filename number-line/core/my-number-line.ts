/** Configurational description of the number line */
export interface INumberLineOptions{
	/**
	 * The genesys pattern that needs to be repeated over
	 * the course of the number line's length. Each item is a tick
	 * that has a length. The array must have at least one item.
	 */
	pattern:number[];
	/**
	 * Base unit value of the number line for magnification=1
	 **/
	baseUnitValue:number;
	/**
	 * The lower and upper breakpoint for unit length as it stretches
	 * and shrinks because of zooming
	 **/
	breakpoints:[number,number];
	/** The labelling strategy for tick marks */
	labelStrategy:ITickMarkLabelStrategy;
	/** 
	 * A number (preferably close to 1) that governs how fast
	 * the tick marks stretches upto {@link breakpointUpperBound} 
	 * before resetting back to the defined {@link breakpointLowerbound}. 
	 * The smaller the number the faster tick marks stretch. This number 
	 * must always be greater than 1
	 * @default 1.3
	 */
	stretchModulo?:number;
	/** 
	 * The initial displacement of the number line
	 * with respect to the origin.
	 * @default 0 
	 */
	initialDisplacement?:number;
	/** 
	 * The initial magnification of the number line.
	 * @default 1 
	 */
	initialMagnification?:number;
	/**
	 * Behaviour of unit length with changing magnification/zoom
	 * 
	 * 1.rigid: Unit length doesn't change. Magnification only changes unit value.
	 * Coverage is continious
	 * 
	 * 2.rubber-band: With increasing magnification unit length stretches from
	 * the defined low towards high breakpoint values untill it snaps back to low
	 * breakpoint value again to repeat the process. Unit value is computed based
	 * on coverage and unit length. Coverage is continious.
	 * 
	 * 3.fallout: Inspired by tools like Sketch, this number line starts off with a
	 * rigid unit length but beyond a certain magnfication, unit value dictates the
	 * unit length. The unit length again stretches between low and high breakpoints
	 * but every subsequent 'rubber-band' snap gets you to the next unit value as
	 * defined by the {@link subdivisionFallout}. Because of this nature, coverage
	 * may have gaps when going from one fallout value to the next.
	 */
	unitLengthType:'rigid'|'rubber-band'|'fallout';
	/** 
	 * Final descending unit values as magnification increases (see example).
	 * This should always be descending and end with a positive number greater than 0.
	 * Also note that, during this range the unit length stretches and contracts
	 * based on magnification unless it is trying to go beyond the last value in 
	 * which case it stretches upto {@link maximumLengthOfLastSubdivision}.
	 * If you leave this array empty, there will be no critical "stretchy,shrinky" 
	 * portion in your number line. This configuration is application specific, but 
	 * for a tool like Sketch, see the example below.
	 * @example 
	 * 'For the following subdivisionFallout'
	 * [200,100,50,20,10],
	 * 'as the magnification increases,'
	 * 'unit value of :'
	 * 200 gets subdivided into 100
	 * 100 gets subdivided into 50
	 * 50 gets subdivided into 20
	 * 20 gets subdivided into 10
	 * 10 does not get subdivided any further
	 **/
	subdivisionFallout:number[];
	/** 
	 * Maximum length of the last subdivision as the magnification increases.
	 * Beyond this point, magnification is disallowed.
	 * If the last number of {@link subdivisionFallout} is 10 and 
	 * {@link maximumLengthOfLastSubdivision} is 500, unit length will be 500 
	 * for a unit value of 10 but there will be no magnification past that point.
	 **/
	maximumLengthOfLastSubdivision:number;

}

export type ScaleCategoryType = 'above'|'within'|'last';

/** 
 * A strechable, zoomable number line view model that can
 * be used to construct functional rulers and graphs. 
 * Partially inspired by the number line used in tools like Sketch
 */
export class NumberLine{

	private _displacement:number = 0;
	private _magnification:number = 1;
	private _unitLength:number = -1;
	private _unitValue:number = -1;

	// a bunch of variables to statefully control zooming
	private _lastZoomValue!:number;
	private _lastZoomAddress!:number;
	private _lastZoomValid = false;
	private _lastZoomScaleCategory!:'above'|'elastic'|'within'|'last';
	
	constructor(private readonly _options:INumberLineOptions){
		this.initialize();
	}

	private initialize(){
		this.options.initialDisplacement = this.options.initialDisplacement==undefined?0:this.options.initialDisplacement;
		this.options.initialMagnification = this.options.initialMagnification==undefined?1:this.options.initialMagnification;
		if(this.options.initialMagnification==undefined){
			this.options.initialMagnification = 1;
		}else if(this.options.initialMagnification<0){
			throw new Error("Initial Magnfication can never be negative. Try a number between 0 and 1 if you want to zoom out");
		}
		if(this.options.stretchModulo==undefined){
			this.options.stretchModulo = 1.3;
		}else if(this.options.stretchModulo<=1){
			throw new Error("Stretch modulo cannot be <=1");
		}

		if(!this.isSortedInStrictlyDescendingOrder(this.options.subdivisionFallout)){
			throw new Error("Subdivision fallout is not sorted in descending order");
		}
		if(this.options.subdivisionFallout.length>0){
			if(this.options.subdivisionFallout[this.options.subdivisionFallout.length-1]<=0){
				throw new Error("Last value of subdivision fallout cannot be 0 or negative");
			}
			if(this.options.subdivisionFallout[0]>this.options.baseUnitValue){
				throw new Error("First subdivision cannot be greater than base unit length");
			}
		}


		// this.options.strechToFit = this.options.strechToFit==undefined?false:this.options.strechToFit;
		
		this._magnification = this.options.initialMagnification;
		this._displacement = this.options.initialDisplacement;
		this.computeScale();
		// if(this.options.strechToFit && this.options.finiteEnd!=undefined){
		// 	this.strechToFit(this.options.finiteEnd);
		// }
	}

	private isSortedInStrictlyDescendingOrder(arr:number[]):boolean{
		if(arr.length==0){
			return true;
		}
		let previous = arr[0];
		for(let i =1;i<arr.length;i++){
			if(arr[i]>=previous){
				return false;
			}
			previous = arr[i];
		}
		return true;
	}

	/**
	 * Checks if supplied unit length is within breakpoint range of this number line
	 * @param l The unit length to check
	 * @returns true if within breakpoint range, false otherwise
	 */
	withinBreakpointRange(l:number):boolean{
		return l>=this.options.breakpoints[0] && l<=this.options.breakpoints[1];
	}

	/**
	 * Stretches the entire number line such that the first
	 * value is the starting value(0) and the last value is the
	 * {@link finalValue}
	 * @param finalValue The last value on the number line
	 * @param length The length within which this number line needs to be stretched
	 * @param approximation In some cases, this is an approximation algorithm. 
	 * This parameter controls the closeness of the approximated value to the {@link finalValue}
	 * @returns True indicates successful coverage. False indicates impossibility to cover. This 
	 * can happen because:
	 * 1. {@link finalValue} is in within category and lies between the min coverage of a fallout 
	 * and the max coverage of the next fallout making it impossible to achieve such a value.
	 * (To avoid this, use 'rubber-band' or 'rigid' unit length types)
	 * 2. {@link finalValue} is below the max magnification coverage
	 */
	strechToFit(finalValue: number,length:number,approximation=0.1) :boolean{
		if(finalValue<=0){
			throw new Error("Final value has to be positive. Consider using rangeFit instead");
		}
		this._displacement = 0;
		const existingMagnification = this.magnification;
		const valuePerLength = finalValue/length;
		// handle the special case for rubber band unit length type
		if(this.options.unitLengthType=='rubber-band'){
			// finalValue is coverage for a the given length
			this._magnification = (this.baseCoverageForElasticUnitScale*length)/(finalValue*this.options.breakpoints[1]);
			this.computeScale();
			return true;
		}else if(this.options.unitLengthType=='rigid'||this.options.subdivisionFallout==null || this.options.subdivisionFallout.length==0){
			console.log("no subdivisions");
			this._unitLength = this.options.breakpoints[0];
			this._unitValue = valuePerLength * this._unitLength;
			this._magnification = this.options.baseUnitValue/this._unitValue;
			return true;
		}else{
			// first we check if the magnification needs to be in the 'above'
			// scale category
			this._magnification = this.options.baseUnitValue/this.options.subdivisionFallout[0];
			this.computeScale();
			const coverage =(finalValue/this.unitValue)*this.unitLength;
			if(approx(coverage,length,0.2)){
				// console.log('direct coverage');
				return true;
			}else if(coverage>length){
				// scale is a direct computation because it is in the
				// 'above' scale category
				console.log('above category');
				this._unitLength = this.options.breakpoints[0];
				this._unitValue = valuePerLength * this._unitLength;
				this._magnification = this.options.baseUnitValue/this._unitValue;
				// console.log('direct computation',this._unitLength,this._unitValue,this.magnification);
				return true;
			}else{
				// 'within' scale category
				// console.log('within scale category');

				const startingMagnification = this.options.baseUnitValue/this.options.subdivisionFallout[0];
				
				for(let i =0;i<this.options.subdivisionFallout.length;i++){
					const thisUnitValue = this.options.subdivisionFallout[i];					
					const maxCoverage = length * thisUnitValue/this.options.breakpoints[0];
					const minCoverage = length * thisUnitValue/this.options.breakpoints[1];
					console.log('min,max',minCoverage,maxCoverage);
					
					if(finalValue>=minCoverage && finalValue<=maxCoverage){
						// answer has been found inside this fallout range
						const magnificationForThisFallout = startingMagnification+this.options.stretchModulo!*i;
						const magnificationForNextFallout = startingMagnification+(this.options.stretchModulo!*(i+1));
						// how many units does it take to fit finalValue in given length
						const c = finalValue/thisUnitValue;
						// fit c units into a length to find unit value for this fallout
						const unitLengthForThisFallout = length/c;
						
						this._magnification = rangeMapper(
							unitLengthForThisFallout,
							this.options.breakpoints[0],
							this.options.breakpoints[1],
							magnificationForThisFallout,
							magnificationForNextFallout
						)

						this.computeScale();
						return true;
					}
					
				}
				
				// if it didn't survive 'within',
				// scale is in the 'last' category
				// console.log('trying last category');
				
				// unit value is always going to be:
				// subdivisionFallout[last index]
				const lastUnitValue = this.options.subdivisionFallout[this.options.subdivisionFallout.length-1];
				const c = finalValue/lastUnitValue;
				const derivedUnitLength = length/c;

				// the 'last' category stretches between
				// breakpoint[0] & maximumLengthOfLastSubdivision
				if(derivedUnitLength>this.options.breakpoints[0]&&derivedUnitLength<this.options.maximumLengthOfLastSubdivision){
					// we have the scale but we still need to find magnification
					// we range map the magnification between stretch marks
					// breakpoint[0] & maximumLengthOfLastSubdivision
					// and
					// starting and ending magnification
					const baseMagnification = this.options.baseUnitValue/this.options.subdivisionFallout[0];
					const startingMagnification = baseMagnification + this.options.stretchModulo! * (this.options.subdivisionFallout.length-1);
					const endingMagnificaiton = startingMagnification + this.options.stretchModulo!;
					this._magnification= rangeMapper(
						derivedUnitLength,
						this.options.breakpoints[0],
						this.options.maximumLengthOfLastSubdivision,
						startingMagnification,
						endingMagnificaiton
					)
					return true;
				}else{
					// outside range, i.e it is not possible to fit
					// console.log('last category but not allowed');
					this._magnification = existingMagnification;
					this.computeScale();
					return false;
				}
			}
		}
	}

	/**
	 * Fits a range within the base length
	 * @param startValue Smaller value
	 * @param endValue Bigger value
	 * @param length The length within which this number line needs to be stretched
	 */
	rangeFit(startValue:number,endValue:number,length:number){
		if(endValue<=startValue){
			throw new Error("Ending value has to be greater than starting value");
		}
		// debugger;
		const difference = endValue - startValue;
		this.strechToFit(difference,length);
		this._displacement = this.locationOf(startValue,true);
		
	}

	/** 
	 * Internal method that must be called everytime there is a change in magnification,
	 * so as to recompute unit length and unit value. Computes in O(1) time
	 * */
	private computeScale(){
		
		this._unitValue = this.options.baseUnitValue / this.magnification;
		// compute the unit length based on which portion of the number line we are in
		const scaleCategory = this.unitScaleCategory();
		// console.log("scale category",scaleCategory);
		if(scaleCategory=='above'){
			// unit length is chosen to be lower breakpoint
			this._unitLength = this.options.breakpoints[0];
		}else if(scaleCategory=='elastic'){
			
			const domainValue = this.magnification%this.options.stretchModulo!;
			this._unitLength = rangeMapper(
				domainValue,
				0,
				this.options.stretchModulo!,
				this.options.breakpoints[0],
				this.options.breakpoints[1]);

			// for any magnification, simply dividing baseCoverage by magnification,
			// gives us the continous coverage
			const coverage = this.baseCoverageForElasticUnitScale/this.magnification;
			// console.log("bc,m,coverage",baseCoverage,this.magnification,coverage);
			this._unitValue = coverage * this._unitLength/this.options.breakpoints[1];
			
			// IGNORE: we find a constant k such that when multiplied by magnification
			// it gives us a continious coverage
			// const k = baseCoverage*this.options.breakpoints[1]/baseUnitLength;
			
		}else if(scaleCategory=='within'){
			
			const startingMagnification = this.options.baseUnitValue/this.options.subdivisionFallout[0];
			const subdivisionIndex = Math.trunc((this.magnification - startingMagnification)/this.options.stretchModulo!);
			this._unitValue = this.options.subdivisionFallout[subdivisionIndex];
			// unit length needs to be carried from before
			const domainValue = 1 + (this.magnification - startingMagnification)%this.options.stretchModulo!;
			
			this._unitLength = rangeMapper(
								domainValue,
								1,
								this.options.stretchModulo!+1,
								this.options.breakpoints[0],
								this.options.breakpoints[1]);
			
		}else{
			// below subdivision range
			this._unitValue = this.options.subdivisionFallout[this.options.subdivisionFallout.length-1];
			if(this.options.maximumLengthOfLastSubdivision<this.options.breakpoints[0]){
				this._unitLength = this.options.maximumLengthOfLastSubdivision;
			}else{
				// we need to linearly interpolate between breakpoint[0] & maximumLengthOfLastSubdivision
				// for this, we need to find to find the interpolation factor
				const startingMagnification = this.options.baseUnitValue/this.options.subdivisionFallout[0];
				const lastMagnificationStart = startingMagnification + this.options.stretchModulo! * (this.options.subdivisionFallout.length-1);
				
				const t = (this.magnification - lastMagnificationStart)/this.options.stretchModulo!;
				this._unitLength = this.options.breakpoints[0]
				+ t*(this.options.maximumLengthOfLastSubdivision - this.options.breakpoints[0]);
				if(this._unitLength>this.options.maximumLengthOfLastSubdivision){
					this._unitLength= this.options.maximumLengthOfLastSubdivision;
				}
			}
			
		}
	}

	/**
	 * Helper for knowing where the number line resides relative to the
	 * subdivision fallout
	 * @returns An enum representing which category the current number line 
	 * configuration is in
	 */
	unitScaleCategory():'above'|'elastic'|'within'|'last'{
		if(this.options.unitLengthType=='rigid'){
			return 'above';
		}else if(this.options.unitLengthType=='rubber-band'){
			return 'elastic';
		}
		// else fallout:
		if(this.options.subdivisionFallout==null || this.options.subdivisionFallout.length==0){
			return 'above';
		}else{

			const startingMagnification = this.options.baseUnitValue/this.options.subdivisionFallout[0];
			if(this.magnification<startingMagnification){
				return 'above';
			}else{
				const subdivisionIndex = Math.trunc((this.magnification - startingMagnification)/this.options.stretchModulo!);
				if(subdivisionIndex<this.options.subdivisionFallout.length){
					const subdivisionValue = this.options.subdivisionFallout[subdivisionIndex];
					console.log("subdivionValue",subdivisionValue," last sub",this.options.subdivisionFallout[this.options.subdivisionFallout.length-1]);
					if(subdivisionValue>this.options.subdivisionFallout[this.options.subdivisionFallout.length-1]){
						return 'within';
					}else{
						return 'last';
					}
				}else{
					console.log("falling last");
					return 'last';
				}
			}
		}
	}

	get baseCoverageForElasticUnitScale():number{
		// for given base unit value at a magnificatino of 1
		// find the base unit length and then base coverage
		const baseUnitLength = rangeMapper(
			1,
			0,
			1.3,
			this.options.breakpoints[0],
			this.options.breakpoints[1])
		
		// for base coverage we can use any fixed length,
		// so in this case we will assume the breakpoints[1]
		const baseCoverage= this.options.breakpoints[1] * this.options.baseUnitValue/baseUnitLength;
		return baseCoverage;
		// return this.options.baseUnitValue;
	}

	/**
	 * Computes the value at specified distance from origin in O(1) time
	 * @param location Position along the number line
	 * @param wrtOrigin True implies location is with respect to origin.
	 * False gives location with respect to the assumed start.
	 * @returns the value on the number line on that distance
	 */
	valueAt(location:number,wrtOrigin:boolean):number{
		this.computeScale();
		if(wrtOrigin){
			return (location/this.unitLength) * this.unitValue;
		}else{
			// find out value since left most point (origin)
			const unitCount = location/this.unitLength;
			const valueSinceOrigin = unitCount * this.unitValue;
			// find out the value of displacement
			const valueOfDisplacement = (this.displacement/this.unitLength)*this.unitValue;
			return valueOfDisplacement + valueSinceOrigin;
		}
	}

	/**
	 * Computes and returns the location of the 
	 * given value along the number line
	 * @param value value that rests at the number line
	 * @param wrtOrigin True implies location is with respect to origin.
	 * False gives location with respect to the assumed start.
	 * @returns The location of this value w.r.t origin
	 */
	locationOf(value:number,wrtOrigin:boolean):number{
		this.computeScale();
		if(wrtOrigin){
			return (value/this.unitValue) * this.unitLength;
		}else{
			return (value/this.unitValue) * this.unitLength - this.displacement;
		}
	}

	/** 
	 * Builds a view model describing this number line 
	 * @returns A view model useful for rendering this number line
	 * through any rendering technology or format
	 */
	buildViewModel(length:number):NumberLineViewModel{
		this.computeScale();
		
		const tickGap = this.tickGap;
		const unitLength = this.unitLength;
		const unitValue= this.unitValue;
		const tickValue= unitValue/this.tickCount;
		
		let firstTickMarkValue:number;
		let firstTickMarkIndex:number;
		let firstTickMarkPosition:number;
		let totalNegativeTicks:number;
		let tickCountsTillFirstTick!:number;
		if(this.displacement>=0){
			tickCountsTillFirstTick = Math.ceil((this.displacement/unitLength)*this.tickCount)
			firstTickMarkValue = tickCountsTillFirstTick*tickValue;
			firstTickMarkIndex = tickCountsTillFirstTick % this.tickCount;
			totalNegativeTicks = 0;
		}else{
			tickCountsTillFirstTick = Math.floor((this.displacement/unitLength)*this.tickCount)
			totalNegativeTicks = -tickCountsTillFirstTick;
			firstTickMarkValue = tickCountsTillFirstTick*tickValue;
			firstTickMarkIndex = totalNegativeTicks % this.tickCount;
		}
		firstTickMarkPosition = tickCountsTillFirstTick*tickGap - this.displacement;
		// console.log("tickCountsTillFirstTick*tickGap: "+tickCountsTillFirstTick*tickGap+"displacement "+this.displacement)

		const totalTicks = Math.floor((length - firstTickMarkPosition)/tickGap);
		const leftoverSpace = length - totalTicks*tickGap;

		const numberLineViewModel:NumberLineViewModel = {
			offset:firstTickMarkPosition,
			leftoverSpace:leftoverSpace,
			startingValue:isActuallyZero(this.firstValue)?0:this.firstValue,
			endingValue:isActuallyZero(this.valueAt(length,false))?0:this.valueAt(length,false),
			length:length,
			numberLine:this,
			tickMarks:[],
			gap:tickGap
		}
		
		for (let i = 0,
			currentTickValue = firstTickMarkValue,
			currentTickPosition = firstTickMarkPosition,
			currentTickIndex = firstTickMarkIndex,
			negativeTicksLeft = totalNegativeTicks
			; i < totalTicks;
			i++,
			currentTickValue+=tickValue,
			currentTickPosition+=tickGap,
			negativeTicksLeft--
			) {

				const tickMarkViewModel:TickMarkViewModel={
					value:isActuallyZero(currentTickValue)?0:currentTickValue,
					position:currentTickPosition,
					height:this.options.pattern[currentTickIndex],
					label:this.options.labelStrategy!=null?
						this.options.labelStrategy.labelFor(
							isActuallyZero(currentTickValue)?0:currentTickValue,
							currentTickIndex,
							currentTickPosition,
							this):
							null,
					patternIndex:currentTickIndex
				}
				numberLineViewModel.tickMarks.push(tickMarkViewModel);
				const indexIncrementer = negativeTicksLeft>0?-1:1;
				currentTickIndex+=indexIncrementer;
				if(currentTickIndex<0){
					currentTickIndex=this.tickCount-1;
				}else if(currentTickIndex>=this.tickCount){
					currentTickIndex = 0;
				}
		}

		return numberLineViewModel;
	}

	

	/** 
	 * Moves the ruler by a specified amount
	 * @param delta The amount to move by. Value can be either positive or negative
	 */
	moveBy(delta:number){
		this._displacement+=delta;
		this._lastZoomValid =false;
	}

	/**
	 * Magnifies the entire ruler either in or out
	 * @param value The value on the number line which
	 * should not move because thats whats being zoomed around.
	 * @param address Address is just like position for the supplied value.
	 * The only difference is that address is bound to the current view model.
	 * Thus, when the view model changes, the same address will give a 
	 * different value(unlike position). Address is used to track and keep the
	 * {@link value} and cursor position in sync with each zoom call.
	 * TLDR: Use renderer specific attribute like event.x to keep value and 
	 * cursor position in sync.
	 * @param delta The amount to magnify by (+ve or -ve)
	 * @returns True if zoom was successful, false if zoom was out of range
	 */
	zoomAround(value:number,address:number,delta:number):boolean{
		if(this._magnification+delta<1){
			return false;
		}
		
		const before = this.locationOf(value,false);
		console.log("before",before);
		this._magnification+=delta;
		this.computeScale();
		const scaleCategory = this.unitScaleCategory();
		console.log("scale category "+scaleCategory," unitLength:"+this.unitLength)
		if(scaleCategory=='last' && this.unitLength>this.options.maximumLengthOfLastSubdivision){
			// cancel all changes and return false
			console.log("last subdivision limit reached");
			this._magnification-=delta;
			this.computeScale();
			return false;
		}
		// TODO store the new magnfication in private lastZoomMagnification
		const after = this.locationOf(value,false);
		const cancelDifference = after - before;
		console.log("cancelDifference",cancelDifference);
		if(scaleCategory!='above'){
			this._displacement+=cancelDifference;
		}

		if(scaleCategory!=this._lastZoomScaleCategory){
			this._lastZoomValid = false;
		}

		// minor correction to maintain sync
		if(this._lastZoomValid){
			if(
				address==this._lastZoomAddress && 
				scaleCategory!='above'){
				const difference = value - this._lastZoomValue;
				const correction = (difference/this.unitValue)*this.unitLength;
				console.log("coming here");
				this._displacement-=correction;
			}else{
				this._lastZoomValue = value;
				this._lastZoomAddress = address;
			}
		}else{
			this._lastZoomValue = value;
			this._lastZoomAddress = address;
			this._lastZoomValid = true;
		}
		

		// when scaleCategory changes from above to within
		// invalidate the lastZoom
		this._lastZoomScaleCategory = scaleCategory;
		return true;
	}

	get options():INumberLineOptions{
		return this._options;
	}

	/**
	 * A factor that governs the scale of the number line.
	 * When magnification==1, you are in the base case.
	 * When magnification>1, you aer zooming in.
	 * When magnification is b/w 0 and 1, you are zooming out. 
	 */
	get magnification():number{
		return this._magnification;
	}

	/** 
	 * The displacement of origin w.r.t the assumed
	 * starting point of the number line. This can also
	 * be thought of as offset. 
	 */
	get displacement():number{
		return this._displacement;
	}

	/** The first value on the number line based on length, displacement and magnification */
	get firstValue():number{
		return this.valueAt(0,false);
	}

	/** Base final value for magnificaiton = 1, displacement=0 for base length */
	// get baseCoverage():number{
	// 	return this.options.baseUnitValue;
	// }

	/** Length of each unit based on current magnification, lower and upper breakpoints */
	get unitLength():number{
		return this._unitLength;
	}

	/** Value of each unit based on magnification and base value of a unit */
	get unitValue():number{
		return this._unitValue;
	}

	/** Number of tick marks in a unit */
	get tickCount():number{
		return this.options.pattern.length;
	}

	/** The gap between ticks in a unit. This is based on the length of each unit. */
	get tickGap():number{
		return this._unitLength/this.tickCount;
	}

}

/** Configurable callback to let the user of NumberLine to define their own tick mark labels */
export interface ITickMarkLabelStrategy{
	/**
	 * Callback for getting the tick mark label for each unit.
	 * @param value Value of this tick mark
	 * @param index Index of this tick mark in the tick mark pattern
	 * @param position The position of this tick mark w.r.t start
	 * @param numberLine The main number line requesting the label
	 * @returns The formatted tick mark label. Return null for blank tick marks.
	 */
	labelFor(value:number,index:number,position:number,numberLine:NumberLine):string;
}

function approx(a:number,b:number,marginOfError=0.1){
	return Math.abs(a-b)<=Math.abs(marginOfError);
}

/**
 * Linearly maps a number from the first range to the second range
 * @param x number lying between a and b
 * @param a lowerbound of first range
 * @param b upperbound of first range
 * @param c lowerbound of second range
 * @param d upperbound of second range
 * @returns number between {@link c} and {@link d} as a result of linear mapping
 */
export function rangeMapper(x:number,a:number,b:number,c:number,d:number):number{
	return ((x-a)/(b-a))*(d-c) + c;
}

/**
 * Checks if a number is actually zero or slightly something else
 * @param n Number possibly 0.0 0 or -0.0
 * @returns True if number is perfectly 0, false otherwise
 */
export function isActuallyZero(n:number):boolean{
	const abs = Math.abs(n);
	if(abs==0){
		// console.log("value:"+abs+" status:"+(abs==0))
	}
	return abs==0;
}

/** ViewModel that describes what a number line looks like */
export interface NumberLineViewModel{
	/** The gap at the start of number line before a tick mark begins */
	offset:number;
	/** The trailing space left between the last tick mark and the length */
	leftoverSpace:number
	/** Gap between tick marks */
	gap:number;
	/** Array of tick marks over the length of this view model */
	tickMarks:TickMarkViewModel[];
	/** The length of this ruler view model */
	length:number;
	/** The value at the start of the number line */
	startingValue:number;
	/** The value at the end of the number line */
	endingValue:number;
	/** The number line for which this view model was created */
	numberLine:NumberLine;
}

/** ViewModel that describes what a tick mark looks like */
export interface TickMarkViewModel{
	/** Height of the tick as governed by the tick mark pattern */
	height:number;
	/** Label on the tick mark as directly received from {@link ITickMarkLabelStrategy} */
	label:string|null;
	/** Value of this tick mark */
	value:number;
	/** Position of this tick mark from the start */
	position:number;
	/** Index of this tick mark in the repeating tick mark pattern */
	patternIndex:number;
}