import CFIconLabel from '@components/CFIconLabel';
import styles from './ContractSection.module.css';
import { breakdown, contractOptions } from './data';
import CFInput from '@components/CFInput';
import CFDropDown from '@components/CFDropDown';
import CFButton from '@components/CFButton';
import { useMetaMask } from '../../hooks/useMetaMask';
import { useState } from 'react';
import unit from 'ethjs-unit';
import CFContractNotification from '@components/CFContractNotification';
import { ethers } from 'ethers';
import GHABI from '../../build/artifacts/contracts/GitHubFunctions.sol/GitHubFunctions.json';
import BillingRegistryContract from '../../build/artifacts/contracts/dev/functions/FunctionsBillingRegistry.sol/FunctionsBillingRegistry.json';
import LinkTokenContract from '../../build/artifacts/@chainlink/contracts/src/v0.4/LinkToken.sol/LinkToken.json';
import { networkConfig } from '../../network-config';
import ContractProgress, { type IProgress } from 'sections/ContractProgress';

const registryAddress = networkConfig.mumbai.functionsBillingRegistryProxy;
const linkTokenAddress = networkConfig.mumbai.linkToken;

const ContractSection = () => {
  const [calculatedAmount, setCalculatedAmount] = useState('');
  const { state: metaMaskState } = useMetaMask();
  const [matic, setMatic] = useState(0);
  const [stars, setStars] = useState(0);
  const [progress, setProgress] = useState<IProgress>(1);
  const [repo, setRepo] = useState<string | undefined>(undefined);
  const [state, setState] = useState<
    'uninitialized' | 'initialized' | 'pending' | 'success' | 'fail'
  >('uninitialized');

  function handleDonation() {
    setState('initialized');
    setProgress(1);
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();
    const billingRegistry = new ethers.Contract(
      registryAddress,
      BillingRegistryContract.abi,
      signer
    );
    const linkToken = new ethers.Contract(
      linkTokenAddress,
      LinkTokenContract.abi,
      signer
    );
    const GHContract = new ethers.Contract(
      process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '',
      GHABI.abi,
      signer
    );

    (async () => {
      try {
        const createSubscriptionTx = await billingRegistry.createSubscription();
        const createSubscriptionReceipt = await createSubscriptionTx.wait();
        const subscriptionId =
          createSubscriptionReceipt.events[0].args['subscriptionId'];

        setProgress(2);

        // fund subscription
        const fundTx = await linkToken.transferAndCall(
          registryAddress,
          ethers.utils.parseUnits('1'),
          ethers.utils.defaultAbiCoder.encode(['uint64'], [subscriptionId])
        );
        await fundTx.wait(1);

        setProgress(3);

        const addTx = await billingRegistry.addConsumer(
          subscriptionId,
          GHContract.address
        );
        await addTx.wait(1);

        setProgress(4);

        // call functions
        const calculationTx = await GHContract.multiplyMetricWithEther(
          [
            `https://github.com/${repo}`,
            `${stars}`,
            unit.toWei(matic, 'ether').toString(10),
          ],
          subscriptionId,
          300_000,
          {
            gasLimit: 600_000,
          }
        );
        await calculationTx.wait(1);

        // Replace random wait with listening to message
        await new Promise((r) => setTimeout(r, 20_000));

        setProgress(5);

        if ((await GHContract.latestError()) !== '0x') {
          setState('uninitialized');
          throw new Error('Chainlink function did not finish successfully.');
        }
        const calculatedAmount = await GHContract.latestResponse();
        setCalculatedAmount(
          (parseInt(calculatedAmount) / 1_000_000_000_000_000_000).toString()
        );

        await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: metaMaskState.wallet,
              to: process.env.NEXT_PUBLIC_ESCROW_ADDRESS,
              value: calculatedAmount,
            },
          ],
        });
        await fetch('/api/donation/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            repo: `https://github.com/${repo}`,
            stars,
            amount: calculatedAmount,
          }),
        });
        setState('success');
      } catch (e) {
        setState('fail');
      }
    })();
  }

  return (
    <section className={styles.container}>
      <div className={styles.content_wrapper}>
        <div>
          <h1 className={styles.info_heading}>
            Sponsor your favorite GitHub creators with Chainlink Functions
          </h1>
          <p className={styles.info_description}>
            Contribute to GitHub creators who meet the goals you define.
            <br/>
            <br/>
            Define a threshold goal for the creator to reach and execute a one-time donation based on your criteria.
          </p>
          <div className={styles.info_breakdown}>
            {breakdown.map(({ icon, text }, breakdownIndex) => (
              <CFIconLabel icon={icon} text={text} key={breakdownIndex} />
            ))}
          </div>
        </div>

        <div className={styles.inputs}>
          {state === 'success' || state === 'fail' ? (
            <CFContractNotification
              status={state}
              onClear={() => {
                setState('uninitialized');
              }}
            />
          ) : (
            <>
              {state === 'initialized' ? (
                <ContractProgress
                  progress={progress}
                  amount={calculatedAmount}
                />
              ) : (
                <>
                  <div>
                    <CFInput
                      type="url"
                      iconType="link"
                      placeholder="Enter GitHub repo URL"
                      base={`${repo || ''}`}
                      onInput={(value) => setRepo(value.slice(19))}
                    />
                  </div>
                  <div className={styles.option_count}>
                    <CFDropDown
                      options={contractOptions}
                      defaultValue={contractOptions[0]}
                    />
                    <CFInput
                      type="text"
                      placeholder="Enter number of stars"
                      onInput={(value) => setStars(+value)}
                    />
                  </div>
                  <div>
                    <CFInput
                      type="text"
                      iconType="matic"
                      placeholder="Enter Matic amount contribution (ex: 0.0001)"
                      onInput={(value) => setMatic(+value)}
                    />
                  </div>
                  <div className={styles.btn_wrapper}>
                    <CFButton
                      text="Execute contract"
                      size="lg"
                      onClick={handleDonation}
                      disabled={
                        !(
                          matic > 0 &&
                          stars > 0 &&
                          repo &&
                          state === 'uninitialized' &&
                          metaMaskState.wallet
                        )
                      }
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
};

export default ContractSection;
