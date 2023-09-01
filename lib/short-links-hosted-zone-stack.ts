import * as cdk from "aws-cdk-lib";
import * as config from "config";
import { HostedZone, IHostedZone } from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";
import { Certificate, CertificateValidation, ICertificate } from "aws-cdk-lib/aws-certificatemanager";

export class ShortLinksHostedZoneStack extends cdk.Stack {
    hostedZone: IHostedZone;
    domainCertificate: ICertificate;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        this.hostedZone = HostedZone.fromLookup(this, "ExistingShortLinksHostedZone", {
            domainName: config.get('nelsonshortlinksservicestack.hostedzone')
        });
        if (this.hostedZone.hostedZoneId == "DUMMY") {
            console.log('No zone found with the specified zone name. Creating new zone');
            this.hostedZone = new HostedZone(this, 'NewShortLinksHostedZone', { zoneName: config.get('nelsonshortlinksservicestack.hostedzone') });
            this.hostedZone.applyRemovalPolicy(config.get('defaultremovalpolicy'));
            //Tag resources
            cdk.Aspects.of(this.hostedZone).add(
                new cdk.Tag('nelson:client', `saas`)
            );
            cdk.Aspects.of(this.hostedZone).add(
                new cdk.Tag('nelson:role', `route53-hosted-zone`)
            );
            cdk.Aspects.of(this.hostedZone).add(
                new cdk.Tag('nelson:env', `prod-saas`)
            );
        }
        else {
            console.log(`Found existing zone: ${this.hostedZone.hostedZoneArn}`);
        }
        //Create a new certificate for new sub domain. Only if we need to create a new cert. If not, we will reuse existing cert
        if (config.get('nelsonshortlinksservicestack.createnewsubdomaincertificate')) {
            this.domainCertificate = new Certificate(this, 'NelsonShortLinksDomainCertificate', {
                domainName: config.get('nelsonshortlinksservicestack.domain'),
                validation: CertificateValidation.fromDns(this.hostedZone),
                certificateName: `${config.get('environmentname')}ShortLinksDomainCertificate`
            });
            this.domainCertificate.applyRemovalPolicy(config.get('defaultremovalpolicy'));

            //Tag certificate
            cdk.Aspects.of(this.domainCertificate).add(
                new cdk.Tag('nelson:environment', config.get('environmentname'))
            );
        }
        else if(config.get('nelsonshortlinksservicestack.certificatearn') != ''){
            this.domainCertificate = Certificate.fromCertificateArn(this, 'ExistingShortLinksDomainCertificate', config.get('nelsonshortlinksservicestack.certificatearn'));
        }
        else {
            throw new Error('Either create a new certificate or specify an existing certificate in the config file');
        }
    }
}