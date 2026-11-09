'use strict'


export class Version {

    private _major:number;
    private _minor:number;
    private _patch:number;
    
    public static hydrate(versionAsObject:any):Version {

        let version: Version;

        if(versionAsObject) {
            version = new Version();
            version.major = versionAsObject._major;
            version.minor = versionAsObject._minor;
            version.patch = versionAsObject._patch;
        }

        return version;
    }

    public static parse(versionAsString:string):Version {

        let version: Version = new Version();

        if(versionAsString && versionAsString.length) {

            let position = versionAsString.indexOf('-');
            if(position > -1) {
                versionAsString = versionAsString.substr(0, position);
            }

            let splitted:any[] = versionAsString.split('.');
            version.major = splitted[0];
            version.minor = splitted[1];
            version.patch = splitted[2];
        }

        return version;
    }

    public static getClosest(version:Version, versions:string[]): Version {

        let closest:Version = null;

        if(!version || !versions || versions.length === 0) {
            return closest;
        }

        let versionAsString = version.toString();
        let groups = versions[0].split('.').length;
        versionAsString = versionAsString.split('.').splice(0, groups).join('.');

        let index = versions.findIndex((v) => v === versionAsString);

        if(index > -1) {
            return Version.parse(versions[index]);
        }

        // Work on a copy: callers pass their resource folder listing and must not
        // be modified. This used to push the requested version into that array.
        let sorted = versions.slice();
        let collator = new Intl.Collator(undefined, { numeric:true });
        sorted.push(versionAsString);
        sorted.sort(collator.compare);

        index = sorted.findIndex((v) => v === versionAsString);

        if(index > -1) {
            let closestAsString;

            if(index === (sorted.length - 1)) {
                // Requested version is newer than everything available.
                closestAsString = sorted[index - 1];
            } else {
                closestAsString = sorted[index + 1];
            }

            if(closestAsString) {
                closest = Version.parse(closestAsString);
            }
        }

        return closest;
    }

    public get major():number {
        return this._major;
    }

    public set major(major:number) {
        this._major = major;
    }

    public get minor():number {
        return this._minor;
    }

    public set minor(minor:number) {
        this._minor = minor;
    }

    public get patch():number {
        return this._patch;
    }

    public set patch(patch:number) {
        this._patch = patch;
    }

    public toString():string {

        if(this.minor == null) {
            return this.major.toString();
        } else if(this.patch == null) {
            return this.major +'.'+ this.minor;
        } else {
            return this.major +'.'+ this.minor +'.'+ this.patch;
        }
        
    }
}